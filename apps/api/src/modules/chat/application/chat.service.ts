import { Injectable, Logger } from '@nestjs/common';
import type {
  AskQuestionInput,
  ChatMessage,
  ChatStreamEvent,
  Citation,
  Conversation,
  Locale,
} from '@everlast/contracts';
import { NotFoundError } from '../../../shared/kernel/domain-error';
import { GroundedAnswerPort } from '../../../shared/ports/grounded-answer.port';
import { TextGenerationPort } from '../../../shared/ports/text-generation.port';
import { AuditService } from '../../../shared/security/audit.service';
import { ConversationRepository } from '../domain/conversation.repository';
import { ChunkRetrievalPort } from '../domain/retrieval.port';

/** Turns of prior context handed to the model. Keeps the prompt bounded. */
const HISTORY_TURNS = 8;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly retrieval: ChunkRetrievalPort,
    private readonly answering: GroundedAnswerPort,
    private readonly generation: TextGenerationPort,
    private readonly audit: AuditService,
  ) {}

  async listConversations(notebookId: string): Promise<Conversation[]> {
    return this.conversations.listByNotebook(notebookId);
  }

  async createConversation(notebookId: string): Promise<Conversation> {
    return this.conversations.create(notebookId);
  }

  async listMessages(notebookId: string, conversationId: string): Promise<ChatMessage[]> {
    await this.requireConversation(notebookId, conversationId);
    return this.conversations.listMessages(conversationId);
  }

  async deleteConversation(notebookId: string, conversationId: string): Promise<void> {
    await this.requireConversation(notebookId, conversationId);
    await this.conversations.delete(conversationId);
  }

  /**
   * Runs one question end to end and yields the events the SSE endpoint writes.
   *
   * The assistant row is created *before* generation starts and completed after,
   * so a client that disconnects mid-answer still finds the partial response in
   * its history rather than losing the turn entirely.
   */
  async *ask(
    notebookId: string,
    conversationId: string | undefined,
    input: AskQuestionInput,
    locale: Locale,
  ): AsyncGenerator<ChatStreamEvent> {
    const conversation = conversationId
      ? await this.requireConversation(notebookId, conversationId)
      : await this.conversations.create(notebookId);

    const history = await this.conversations.listMessages(conversation.id, HISTORY_TURNS * 2);

    await this.conversations.appendMessage({
      conversationId: conversation.id,
      notebookId,
      role: 'user',
      content: input.question,
    });

    const assistant = await this.conversations.appendMessage({
      conversationId: conversation.id,
      notebookId,
      role: 'assistant',
      content: '',
    });

    yield { type: 'message_start', messageId: assistant.id, conversationId: conversation.id };

    const chunks = await this.retrieval.search({
      notebookId,
      question: input.question,
      sourceIds: input.sourceIds,
    });

    const citations = new Map<number, Citation>();
    let answer = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      const stream = this.answering.stream({
        question: input.question,
        chunks,
        history: history.slice(-HISTORY_TURNS * 2).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        locale,
      });

      for await (const event of stream) {
        if (event.type === 'text') {
          answer += event.text;
          yield { type: 'text_delta', text: event.text };
          continue;
        }

        if (event.type === 'citation') {
          const isNew = !citations.has(event.citation.marker);
          citations.set(event.citation.marker, event.citation);

          // The marker is appended to the answer text at the point the model
          // cited, so the stored message reads the same as the live stream.
          const marker = ` [${event.citation.marker}]`;
          answer += marker;
          yield { type: 'text_delta', text: marker };

          if (isNew) yield { type: 'citations', citations: [event.citation] };
          continue;
        }

        usage = event.usage;
      }
    } catch (error) {
      this.logger.error({ err: error, notebookId }, 'answer generation failed');
      await this.persist(assistant.id, answer, citations, usage);
      yield {
        type: 'error',
        code: 'chat.generation_failed',
        message: 'The answer could not be completed. Please try again.',
      };
      return;
    }

    await this.persist(assistant.id, answer, citations, usage);
    await this.maybeTitle(conversation, input.question, answer);

    await this.audit.record({
      action: 'chat.answered',
      notebookId,
      targetType: 'conversation',
      targetId: conversation.id,
      metadata: { retrieved: chunks.length, cited: citations.size },
    });

    yield {
      type: 'message_end',
      messageId: assistant.id,
      citations: [...citations.values()].sort((a, b) => a.marker - b.marker),
      ...(usage ? { usage } : {}),
    };
  }

  private async persist(
    messageId: string,
    answer: string,
    citations: Map<number, Citation>,
    usage?: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    await this.conversations.completeMessage(
      messageId,
      answer,
      [...citations.values()].sort((a, b) => a.marker - b.marker),
      {
        model: 'claude',
        ...(usage
          ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
          : {}),
      },
    );
  }

  /**
   * Names a conversation from its first exchange. Best effort — a failure here
   * leaves the default title and must never surface to the user.
   */
  private async maybeTitle(
    conversation: Conversation,
    question: string,
    answer: string,
  ): Promise<void> {
    if (conversation.title !== 'New chat') return;

    try {
      const title = await this.generation.generateText(
        'Write a 3-6 word title for this conversation, in the language of the question. Reply with the title only — no quotes, no punctuation at the end.',
        `Question: ${question}\n\nAnswer: ${answer.slice(0, 800)}`,
        { tier: 'utility', maxTokens: 200 },
      );

      const cleaned = title.replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 80);
      if (cleaned) await this.conversations.rename(conversation.id, cleaned);
    } catch (error) {
      this.logger.debug({ err: error }, 'conversation title generation failed');
    }
  }

  private async requireConversation(
    notebookId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversations.findById(notebookId, conversationId);
    if (!conversation) throw new NotFoundError('conversation', conversationId);
    return conversation;
  }
}

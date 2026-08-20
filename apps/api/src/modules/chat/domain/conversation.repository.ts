import type { ChatMessage, Citation, Conversation } from '@everlast/contracts';

export interface AppendMessageInput {
  conversationId: string;
  notebookId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export abstract class ConversationRepository {
  abstract listByNotebook(notebookId: string): Promise<Conversation[]>;
  abstract findById(notebookId: string, conversationId: string): Promise<Conversation | null>;
  abstract create(notebookId: string, title?: string): Promise<Conversation>;
  abstract rename(conversationId: string, title: string): Promise<void>;
  abstract delete(conversationId: string): Promise<void>;

  abstract listMessages(conversationId: string, limit?: number): Promise<ChatMessage[]>;
  abstract appendMessage(input: AppendMessageInput): Promise<ChatMessage>;
  /** Fills in an assistant message that was created empty before streaming. */
  abstract completeMessage(
    messageId: string,
    content: string,
    citations: Citation[],
    usage: { model: string; inputTokens?: number; outputTokens?: number },
  ): Promise<void>;
}

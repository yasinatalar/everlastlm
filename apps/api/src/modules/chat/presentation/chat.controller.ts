import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  askQuestionSchema,
  localeSchema,
  uuidSchema,
  type AskQuestionInput,
  type ChatMessage,
  type ChatStreamEvent,
  type Conversation,
  type Locale,
} from '@everlast/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { AiRateLimited } from '../../../shared/security/throttling';
import { ChatService } from '../application/chat.service';

const askBodySchema = askQuestionSchema.extend({
  conversationId: uuidSchema.optional(),
});

@Controller('notebooks/:notebookId/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  @RequiresNotebookRole('viewer')
  async listConversations(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<Conversation[]> {
    return this.chat.listConversations(notebookId);
  }

  @Post('conversations')
  @RequiresNotebookRole('viewer')
  async createConversation(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<Conversation> {
    return this.chat.createConversation(notebookId);
  }

  @Get('conversations/:conversationId/messages')
  @RequiresNotebookRole('viewer')
  async listMessages(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('conversationId', zodPipe(uuidSchema)) conversationId: string,
  ): Promise<ChatMessage[]> {
    return this.chat.listMessages(notebookId, conversationId);
  }

  @Delete('conversations/:conversationId')
  @RequiresNotebookRole('viewer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('conversationId', zodPipe(uuidSchema)) conversationId: string,
  ): Promise<void> {
    await this.chat.deleteConversation(notebookId, conversationId);
  }

  /**
   * Streams an answer as Server-Sent Events.
   *
   * A POST body is needed (the question can be long), which rules out the
   * browser's `EventSource`; the client reads the response stream directly.
   * The event framing is still SSE so the wire format stays inspectable and
   * proxies that understand it behave.
   */
  @Post('stream')
  @RequiresNotebookRole('viewer')
  @AiRateLimited()
  async stream(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(askBodySchema)) body: AskQuestionInput & { conversationId?: string },
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    response.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeats response buffering in nginx-style proxies, which would
      // otherwise hold the whole answer until completion.
      'X-Accel-Buffering': 'no',
    });

    const send = (event: ChatStreamEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // The client going away must stop generation rather than leaving the model
    // streaming into a dead socket.
    let aborted = false;
    response.on('close', () => {
      aborted = true;
    });

    try {
      for await (const event of this.chat.ask(
        notebookId,
        body.conversationId,
        { question: body.question, ...(body.sourceIds ? { sourceIds: body.sourceIds } : {}) },
        parseLocale(acceptLanguage),
      )) {
        if (aborted) break;
        send(event);
      }
    } catch (error) {
      if (!aborted) {
        send({
          type: 'error',
          code: 'chat.stream_failed',
          message: 'The answer stream ended unexpectedly.',
        });
      }
      throw error;
    } finally {
      if (!aborted) response.end();
    }
  }
}

/** First supported language in the header wins; falls back to English. */
const parseLocale = (header: string | undefined): Locale => {
  const candidates = (header ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().slice(0, 2).toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    const parsed = localeSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return 'en';
};

/** Re-exported so the schema participates in the contract tests. */
export type AskBody = z.infer<typeof askBodySchema>;

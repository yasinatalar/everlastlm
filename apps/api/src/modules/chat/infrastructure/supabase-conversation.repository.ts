import { Injectable } from '@nestjs/common';
import type { ChatMessage, Citation, Conversation } from '@everlast/contracts';
import { citationSchema } from '@everlast/contracts';
import type {
  ConversationRow,
  Json,
  MessageRow,
} from '../../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { DependencyFailureError } from '../../../shared/kernel/domain-error';
import {
  ConversationRepository,
  type AppendMessageInput,
} from '../domain/conversation.repository';

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Citations were valid when written, but a schema change or a hand-edited row
 * could make them wrong now. Parsing on read means a bad record degrades to a
 * message without citations instead of crashing the conversation.
 */
const parseCitations = (value: Json): Citation[] => {
  if (!Array.isArray(value)) return [];
  const result: Citation[] = [];
  for (const entry of value) {
    const parsed = citationSchema.safeParse(entry);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
};

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  citations: parseCitations(row.citations),
  createdAt: row.created_at,
});

@Injectable()
export class SupabaseConversationRepository extends ConversationRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {
    super();
  }

  async listByNotebook(notebookId: string): Promise<Conversation[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('conversations')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) this.supabase.fail('conversations.list', error);
    return (data ?? []).map(toConversation);
  }

  async findById(notebookId: string, conversationId: string): Promise<Conversation | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('notebook_id', notebookId)
      .maybeSingle();

    if (error) this.supabase.fail('conversations.findById', error);
    return data ? toConversation(data) : null;
  }

  async create(notebookId: string, title?: string): Promise<Conversation> {
    const user = this.context.requireUser();

    const { data, error } = await this.supabase
      .forUser()
      .from('conversations')
      .insert({
        notebook_id: notebookId,
        created_by: user.id,
        ...(title ? { title } : {}),
      })
      .select('*')
      .single();

    if (error || !data) {
      this.supabase.fail('conversations.create', error ?? { message: 'no row returned' });
    }
    return toConversation(data);
  }

  async rename(conversationId: string, title: string): Promise<void> {
    const { error } = await this.supabase
      .forUser()
      .from('conversations')
      .update({ title })
      .eq('id', conversationId);

    if (error) this.supabase.fail('conversations.rename', error);
  }

  async delete(conversationId: string): Promise<void> {
    const { error } = await this.supabase
      .forUser()
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) this.supabase.fail('conversations.delete', error);
  }

  async listMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) this.supabase.fail('messages.list', error);
    return (data ?? []).map(toMessage);
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
    const user = this.context.requireUser();

    const { data, error } = await this.supabase
      .forUser()
      .from('messages')
      .insert({
        conversation_id: input.conversationId,
        notebook_id: input.notebookId,
        author_id: input.role === 'user' ? user.id : null,
        role: input.role,
        content: input.content,
        citations: (input.citations ?? []) as unknown as Json,
        model: input.model ?? null,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new DependencyFailureError('supabase', 'could not store the message');
    }

    // Touch the conversation so it sorts to the top of the list. The value sent
    // is irrelevant — the `conversations_touch` trigger overwrites it — but an
    // UPDATE with no columns is not valid SQL, so a column must be named.
    await this.supabase
      .forUser()
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.conversationId);

    return toMessage(data);
  }

  /**
   * Written with the service role: the stream can outlive the request context
   * when a client disconnects mid-answer, and the partial answer must still be
   * persisted. Authorisation was established when the message row was created.
   */
  async completeMessage(
    messageId: string,
    content: string,
    citations: Citation[],
    usage: { model: string; inputTokens?: number; outputTokens?: number },
  ): Promise<void> {
    const { error } = await this.supabase
      .admin
      .from('messages')
      .update({
        content,
        citations: citations as unknown as Json,
        model: usage.model,
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
      })
      .eq('id', messageId);

    if (error) this.supabase.fail('messages.complete', error);
  }
}

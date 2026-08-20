/**
 * Typed mirror of `supabase/migrations`. Hand-maintained rather than generated
 * so the repo builds without a live database; regenerate with
 * `supabase gen types typescript --local` when the schema changes and diff.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type NotebookRole = 'owner' | 'editor' | 'viewer';
export type SourceKind = 'pdf' | 'docx' | 'text' | 'markdown' | 'url';
export type SourceStatus =
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'failed';
export type MessageRole = 'user' | 'assistant';
export type NoteOrigin = 'manual' | 'chat' | 'studio';
export type StudioKind =
  | 'study_guide'
  | 'briefing_doc'
  | 'faq'
  | 'timeline'
  | 'audio_overview';
export type StudioStatus = 'pending' | 'generating' | 'ready' | 'failed';

export type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  theme: string;
  created_at: string;
  updated_at: string;
};

export type NotebookRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  source_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type NotebookMemberRow = {
  notebook_id: string;
  user_id: string;
  role: NotebookRole;
  invited_by: string | null;
  created_at: string;
};

export type SourceRow = {
  id: string;
  notebook_id: string;
  created_by: string | null;
  kind: SourceKind;
  title: string;
  origin_uri: string | null;
  storage_path: string | null;
  byte_size: number | null;
  checksum: string | null;
  status: SourceStatus;
  failure_reason: string | null;
  summary: string | null;
  key_topics: string[];
  token_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type SourceChunkRow = {
  id: string;
  source_id: string;
  notebook_id: string;
  chunk_index: number;
  content: string;
  heading_path: string[];
  page_number: number | null;
  char_start: number | null;
  char_end: number | null;
  token_count: number;
  embedding: string | null;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  notebook_id: string;
  created_by: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  notebook_id: string;
  author_id: string | null;
  role: MessageRole;
  content: string;
  citations: Json;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export type NoteRow = {
  id: string;
  notebook_id: string;
  created_by: string | null;
  title: string;
  content: string;
  origin: NoteOrigin;
  citations: Json;
  created_at: string;
  updated_at: string;
};

export type StudioArtifactRow = {
  id: string;
  notebook_id: string;
  created_by: string | null;
  kind: StudioKind;
  status: StudioStatus;
  title: string;
  content: Json;
  source_ids: string[];
  audio_storage_path: string | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditEventRow = {
  id: number;
  actor_id: string | null;
  notebook_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Json;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export type MatchedChunkRow = {
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_kind: SourceKind;
  chunk_index: number;
  content: string;
  heading_path: string[];
  page_number: number | null;
  similarity: number;
  score: number;
};

type Table<Row, Insert = Row, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        Pick<ProfileRow, 'id'> & Partial<Omit<ProfileRow, 'id'>>
      >;
      notebooks: Table<
        NotebookRow,
        Pick<NotebookRow, 'owner_id' | 'title'> &
          Partial<Omit<NotebookRow, 'owner_id' | 'title'>>
      >;
      notebook_members: Table<
        NotebookMemberRow,
        Pick<NotebookMemberRow, 'notebook_id' | 'user_id'> &
          Partial<Omit<NotebookMemberRow, 'notebook_id' | 'user_id'>>
      >;
      sources: Table<
        SourceRow,
        Pick<SourceRow, 'notebook_id' | 'kind' | 'title'> &
          Partial<Omit<SourceRow, 'notebook_id' | 'kind' | 'title'>>
      >;
      source_chunks: Table<
        SourceChunkRow,
        Pick<SourceChunkRow, 'source_id' | 'notebook_id' | 'chunk_index' | 'content'> &
          Partial<Omit<SourceChunkRow, 'source_id' | 'notebook_id' | 'chunk_index' | 'content'>>
      >;
      conversations: Table<
        ConversationRow,
        Pick<ConversationRow, 'notebook_id'> & Partial<Omit<ConversationRow, 'notebook_id'>>
      >;
      messages: Table<
        MessageRow,
        Pick<MessageRow, 'conversation_id' | 'notebook_id' | 'role'> &
          Partial<Omit<MessageRow, 'conversation_id' | 'notebook_id' | 'role'>>
      >;
      notes: Table<
        NoteRow,
        Pick<NoteRow, 'notebook_id'> & Partial<Omit<NoteRow, 'notebook_id'>>
      >;
      studio_artifacts: Table<
        StudioArtifactRow,
        Pick<StudioArtifactRow, 'notebook_id' | 'kind'> &
          Partial<Omit<StudioArtifactRow, 'notebook_id' | 'kind'>>
      >;
      audit_events: Table<
        AuditEventRow,
        Pick<AuditEventRow, 'action'> & Partial<Omit<AuditEventRow, 'action' | 'id'>>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      match_source_chunks: {
        Args: {
          p_notebook_id: string;
          p_query_embedding: string;
          p_query_text?: string | null;
          p_source_ids?: string[] | null;
          p_match_count?: number;
          p_rrf_k?: number;
        };
        Returns: MatchedChunkRow[];
      };
      archive_notebook: { Args: { p_notebook_id: string }; Returns: undefined };
      is_notebook_member: { Args: { p_notebook_id: string }; Returns: boolean };
      is_notebook_editor_member: { Args: { p_notebook_id: string }; Returns: boolean };
      can_edit_notebook: { Args: { p_notebook_id: string }; Returns: boolean };
      is_notebook_owner: { Args: { p_notebook_id: string }; Returns: boolean };
      notebook_role_of: { Args: { p_notebook_id: string }; Returns: NotebookRole | null };
    };
    Enums: {
      notebook_role: NotebookRole;
      source_kind: SourceKind;
      source_status: SourceStatus;
      message_role: MessageRole;
      note_origin: NoteOrigin;
      studio_kind: StudioKind;
      studio_status: StudioStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

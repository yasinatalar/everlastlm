/**
 * Domain events describe something that already happened, in the language of
 * the domain. They are published after the write succeeds and are the seam
 * where cross-context reactions (audit logging, ingestion kick-off, artifact
 * invalidation) attach without the producing module knowing the consumers.
 */
export interface DomainEvent {
  readonly name: string;
  readonly occurredAt: Date;
  readonly notebookId?: string;
  readonly actorId?: string;
  readonly payload: Record<string, unknown>;
}

export const domainEvent = (
  name: string,
  payload: Record<string, unknown>,
  context: { notebookId?: string; actorId?: string } = {},
): DomainEvent => ({
  name,
  occurredAt: new Date(),
  payload,
  ...context,
});

'use client';

import { ArrowUp, Check, Copy, MessageSquarePlus, Sparkles, Square, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { ChatMessage } from '@everlast/contracts';
import { MessageContent } from '@/components/chat/message-content';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { useAskQuestion, useConversations, useMessages } from '@/hooks/use-chat';
import { useCreateNote } from '@/hooks/use-studio';
import { cn } from '@/lib/utils';

export function ChatPanel({
  notebookId,
  sourceIds,
  allSelected,
  totalReadySources,
  canEdit,
  className,
}: {
  notebookId: string;
  sourceIds: string[];
  allSelected: boolean;
  totalReadySources: number;
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations('chat');

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  const { data: conversations } = useConversations(notebookId);
  const { data: messages } = useMessages(notebookId, conversationId);
  const { ask, stop, streaming, pending, error } = useAskQuestion(notebookId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Open the most recent conversation on first load so a returning user lands
  // back where they were rather than on a blank chat.
  //
  // Strictly once per notebook. Re-running on every `conversationId` change is
  // what made "New chat" look broken: the button cleared the selection, this
  // effect saw a null id and put the very same conversation straight back.
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (restoredFor.current === notebookId || !conversations?.[0]) return;
    restoredFor.current = notebookId;
    setConversationId(conversations[0].id);
  }, [conversations, notebookId]);

  // Follow the stream. `scrollTop` is set directly rather than via
  // `scrollIntoView` so it never steals focus from the composer.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streaming?.text]);

  const hasSources = totalReadySources > 0;
  const canSend = question.trim().length > 0 && !pending && hasSources;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;

    const value = question.trim();
    setQuestion('');

    await ask({
      question: value,
      conversationId,
      // Omitted when everything is selected, so the API treats it as "all
      // sources" and newly added ones are included automatically.
      ...(allSelected ? {} : { sourceIds }),
      onConversationCreated: setConversationId,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line — the convention every chat UI
    // has trained users on.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const showEmpty = !messages?.length && !streaming;

  return (
    <section className={cn('flex flex-col bg-background', className)}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-default px-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground-muted">
          {t('title')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConversationId(null)}
          disabled={pending || conversationId === null}
        >
          <MessageSquarePlus className="size-3.5" />
          {t('newChat')}
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {showEmpty ? (
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                hasSources && (
                  <div className="flex flex-col items-stretch gap-1.5">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-subtle">
                      {t('suggestionsTitle')}
                    </p>
                    {(['suggestion1', 'suggestion2', 'suggestion3'] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setQuestion(t(key));
                          textareaRef.current?.focus();
                        }}
                        className="rounded-lg border border-border-default bg-surface px-3 py-2 text-left text-[13px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                )
              }
            />
          ) : (
            <ul className="space-y-6">
              {messages?.map((message) => (
                <li key={message.id}>
                  <MessageBubble
                    notebookId={notebookId}
                    message={message}
                    canEdit={canEdit}
                  />
                </li>
              ))}

              {streaming && (
                <li>
                  {streaming.text ? (
                    <div className="animate-in-up">
                      <MessageContent
                        content={streaming.text}
                        citations={streaming.citations}
                      />
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-[13px] text-foreground-muted">
                      <span className="flex gap-1" aria-hidden>
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="size-1.5 animate-bounce rounded-full bg-accent"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                      {t('thinking')}
                    </p>
                  )}
                </li>
              )}

              {error && (
                <li role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger">
                  {t('failed')}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border-default bg-surface px-4 py-3">
        <form onSubmit={submit} className="mx-auto w-full max-w-3xl">
          {!allSelected && hasSources && (
            <p className="mb-1.5 text-[11px] text-foreground-subtle">
              {t('scopedToSelection', { count: sourceIds.length })}
            </p>
          )}

          <div className="flex items-end gap-2 rounded-xl border border-border-default bg-background p-2 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                // Grow to fit, up to a ceiling — a composer that grows without
                // bound eats the transcript it is meant to serve.
                event.target.style.height = 'auto';
                event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={!hasSources}
              maxLength={4000}
              placeholder={hasSources ? t('placeholder') : t('placeholderNoSources')}
              aria-label={t('placeholder')}
              className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed placeholder:text-foreground-subtle focus:outline-none disabled:cursor-not-allowed"
            />

            {pending ? (
              <Button type="button" variant="secondary" size="icon" onClick={stop} aria-label={t('stop')}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="icon"
                disabled={!canSend}
                aria-label={t('send')}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function MessageBubble({
  notebookId,
  message,
  canEdit,
}: {
  notebookId: string;
  message: ChatMessage;
  canEdit: boolean;
}) {
  const t = useTranslations('chat');
  const createNote = useCreateNote(notebookId);
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed shadow-panel">
          {message.content}
        </p>
      </div>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveAsNote = async () => {
    await createNote.mutateAsync({
      content: message.content,
      origin: 'chat',
      citations: message.citations,
    });
    toast.success(t('savedAsNote'));
  };

  return (
    <div className="group">
      <MessageContent content={message.content} citations={message.citations} />

      <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t('copied') : t('copy')}
        </Button>

        {canEdit && (
          <Button variant="ghost" size="sm" onClick={saveAsNote} loading={createNote.isPending}>
            <StickyNote className="size-3" />
            {t('saveAsNote')}
          </Button>
        )}

        {message.citations.length > 0 && (
          <span className="ml-1 text-[11px] text-foreground-subtle">
            {t('sourcesUsed', { count: message.citations.length })}
          </span>
        )}
      </div>
    </div>
  );
}

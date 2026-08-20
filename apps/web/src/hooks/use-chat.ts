'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  chatStreamEventSchema,
  type ChatMessage,
  type Citation,
  type Conversation,
} from '@everlast/contracts';
import { useLocale } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { apiFetch, apiStream } from '@/lib/api-client';

export const chatKeys = {
  conversations: (notebookId: string) => ['notebooks', notebookId, 'conversations'] as const,
  messages: (notebookId: string, conversationId: string) =>
    ['notebooks', notebookId, 'conversations', conversationId, 'messages'] as const,
};

export const useConversations = (notebookId: string) =>
  useQuery({
    queryKey: chatKeys.conversations(notebookId),
    queryFn: () => apiFetch<Conversation[]>(`/notebooks/${notebookId}/chat/conversations`),
  });

export const useMessages = (notebookId: string, conversationId: string | null) =>
  useQuery({
    queryKey: chatKeys.messages(notebookId, conversationId ?? 'none'),
    queryFn: () =>
      apiFetch<ChatMessage[]>(
        `/notebooks/${notebookId}/chat/conversations/${conversationId}/messages`,
      ),
    enabled: Boolean(conversationId),
  });

export const useDeleteConversation = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}/chat/conversations/${conversationId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations(notebookId) }),
  });
};

export interface StreamingAnswer {
  text: string;
  citations: Citation[];
}

/**
 * Drives one streamed answer.
 *
 * The in-flight answer is local state rather than query cache: it changes on
 * every token, and pushing that through the cache would re-render every
 * subscriber dozens of times a second. Once the stream ends, the authoritative
 * message list is refetched and the local buffer is dropped.
 */
export const useAskQuestion = (notebookId: string) => {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [streaming, setStreaming] = useState<StreamingAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  const ask = useCallback(
    async (input: {
      question: string;
      conversationId: string | null;
      sourceIds?: string[];
      onConversationCreated?: (conversationId: string) => void;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPending(true);
      setError(null);
      setStreaming({ text: '', citations: [] });

      let conversationId = input.conversationId;

      try {
        const response = await apiStream(
          `/notebooks/${notebookId}/chat/stream`,
          {
            question: input.question,
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            ...(input.sourceIds?.length ? { sourceIds: input.sourceIds } : {}),
          },
          { signal: controller.signal, locale },
        );

        const reader = response.body?.getReader();
        if (!reader) throw new Error('no response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; anything after the last
          // separator is a partial frame and stays in the buffer.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
            if (!line) continue;

            const parsed = chatStreamEventSchema.safeParse(JSON.parse(line.slice(6)));
            if (!parsed.success) continue;
            const event = parsed.data;

            if (event.type === 'message_start') {
              conversationId = event.conversationId;
              if (!input.conversationId) input.onConversationCreated?.(event.conversationId);
            } else if (event.type === 'text_delta') {
              setStreaming((current) =>
                current ? { ...current, text: current.text + event.text } : current,
              );
            } else if (event.type === 'citations') {
              setStreaming((current) =>
                current
                  ? { ...current, citations: [...current.citations, ...event.citations] }
                  : current,
              );
            } else if (event.type === 'error') {
              setError(event.message);
            }
          }
        }

        if (conversationId) {
          await queryClient.invalidateQueries({
            queryKey: chatKeys.messages(notebookId, conversationId),
          });
        }
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations(notebookId) });
      } catch (caught) {
        // An abort is the user pressing stop, not a failure.
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError(caught instanceof Error ? caught.message : 'stream failed');
        }
      } finally {
        setPending(false);
        setStreaming(null);
        abortRef.current = null;
      }
    },
    [locale, notebookId, queryClient],
  );

  return { ask, stop, streaming, pending, error };
};

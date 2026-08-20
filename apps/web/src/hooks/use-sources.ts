'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TERMINAL_SOURCE_STATUSES,
  type AddTextSourceInput,
  type AddUrlSourceInput,
  type Source,
} from '@everlast/contracts';
import { apiFetch, apiUpload } from '@/lib/api-client';
import { notebookKeys } from './use-notebooks';

export const sourceKeys = {
  list: (notebookId: string) => ['notebooks', notebookId, 'sources'] as const,
};

/**
 * Ingestion runs in the background, so the list polls while anything is still
 * being processed and stops as soon as every source reaches a terminal state.
 * Polling only while there is something to watch keeps an idle notebook silent.
 */
export const useSources = (notebookId: string) =>
  useQuery({
    queryKey: sourceKeys.list(notebookId),
    queryFn: () => apiFetch<Source[]>(`/notebooks/${notebookId}/sources`),
    refetchInterval: (query) => {
      const sources = query.state.data;
      if (!sources) return false;

      const working = sources.some(
        (source) => !TERMINAL_SOURCE_STATUSES.includes(source.status),
      );
      return working ? 2500 : false;
    },
  });

const useSourceMutation = <TInput>(
  notebookId: string,
  mutationFn: (input: TInput) => Promise<Source>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourceKeys.list(notebookId) });
      // The notebook card shows a source count.
      void queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) });
    },
  });
};

export const useUploadSource = (notebookId: string) =>
  useSourceMutation(notebookId, (file: File) =>
    apiUpload<Source>(`/notebooks/${notebookId}/sources/upload`, file),
  );

export const useAddUrlSource = (notebookId: string) =>
  useSourceMutation(notebookId, (input: AddUrlSourceInput) =>
    apiFetch<Source>(`/notebooks/${notebookId}/sources/url`, { method: 'POST', body: input }),
  );

export const useAddTextSource = (notebookId: string) =>
  useSourceMutation(notebookId, (input: AddTextSourceInput) =>
    apiFetch<Source>(`/notebooks/${notebookId}/sources/text`, { method: 'POST', body: input }),
  );

export const useRetrySource = (notebookId: string) =>
  useSourceMutation(notebookId, (sourceId: string) =>
    apiFetch<Source>(`/notebooks/${notebookId}/sources/${sourceId}/retry`, { method: 'POST' }),
  );

export const useDeleteSource = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}/sources/${sourceId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourceKeys.list(notebookId) });
      void queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) });
    },
  });
};

export const openSourceOriginal = async (notebookId: string, sourceId: string) => {
  const { url } = await apiFetch<{ url: string }>(
    `/notebooks/${notebookId}/sources/${sourceId}/download`,
  );
  window.open(url, '_blank', 'noopener,noreferrer');
};

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateNoteInput,
  GenerateStudioArtifactInput,
  Note,
  StudioArtifact,
  UpdateNoteInput,
} from '@everlast/contracts';
import { apiFetch } from '@/lib/api-client';

export const studioKeys = {
  artifacts: (notebookId: string) => ['notebooks', notebookId, 'studio'] as const,
  notes: (notebookId: string) => ['notebooks', notebookId, 'notes'] as const,
};

/** Polls while any artifact is still being generated; see `useSources`. */
export const useStudioArtifacts = (notebookId: string) =>
  useQuery({
    queryKey: studioKeys.artifacts(notebookId),
    queryFn: () => apiFetch<StudioArtifact[]>(`/notebooks/${notebookId}/studio`),
    refetchInterval: (query) => {
      const artifacts = query.state.data;
      if (!artifacts) return false;

      const working = artifacts.some(
        (artifact) => artifact.status === 'pending' || artifact.status === 'generating',
      );
      return working ? 4000 : false;
    },
  });

export const useGenerateArtifact = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: GenerateStudioArtifactInput) =>
      apiFetch<StudioArtifact>(`/notebooks/${notebookId}/studio`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: studioKeys.artifacts(notebookId) }),
  });
};

export const useDeleteArtifact = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (artifactId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}/studio/${artifactId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: studioKeys.artifacts(notebookId) }),
  });
};

export const useNotes = (notebookId: string) =>
  useQuery({
    queryKey: studioKeys.notes(notebookId),
    queryFn: () => apiFetch<Note[]>(`/notebooks/${notebookId}/notes`),
  });

export const useCreateNote = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      apiFetch<Note>(`/notebooks/${notebookId}/notes`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.notes(notebookId) }),
  });
};

export const useUpdateNote = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, ...input }: UpdateNoteInput & { noteId: string }) =>
      apiFetch<Note>(`/notebooks/${notebookId}/notes/${noteId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.notes(notebookId) }),
  });
};

export const useDeleteNote = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.notes(notebookId) }),
  });
};

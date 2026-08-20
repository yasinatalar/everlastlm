'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangeMemberRoleInput,
  CreateNotebookInput,
  InviteMemberInput,
  Notebook,
  NotebookMember,
  Page,
  UpdateNotebookInput,
} from '@everlast/contracts';
import { apiFetch } from '@/lib/api-client';

export const notebookKeys = {
  all: ['notebooks'] as const,
  list: (search?: string) => ['notebooks', 'list', search ?? ''] as const,
  detail: (id: string) => ['notebooks', id] as const,
  members: (id: string) => ['notebooks', id, 'members'] as const,
};

export const useNotebooks = (search?: string) =>
  useQuery({
    queryKey: notebookKeys.list(search),
    queryFn: () =>
      apiFetch<Page<Notebook>>(
        `/notebooks${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

export const useNotebook = (notebookId: string) =>
  useQuery({
    queryKey: notebookKeys.detail(notebookId),
    queryFn: () => apiFetch<Notebook>(`/notebooks/${notebookId}`),
  });

export const useCreateNotebook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateNotebookInput) =>
      apiFetch<Notebook>('/notebooks', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notebookKeys.all }),
  });
};

export const useUpdateNotebook = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateNotebookInput) =>
      apiFetch<Notebook>(`/notebooks/${notebookId}`, { method: 'PATCH', body: input }),
    onSuccess: (notebook) => {
      queryClient.setQueryData(notebookKeys.detail(notebookId), notebook);
      void queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },
  });
};

export const useDeleteNotebook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notebookId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notebookKeys.all }),
  });
};

export const useMembers = (notebookId: string, enabled = true) =>
  useQuery({
    queryKey: notebookKeys.members(notebookId),
    queryFn: () => apiFetch<NotebookMember[]>(`/notebooks/${notebookId}/members`),
    enabled,
  });

export const useInviteMember = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InviteMemberInput) =>
      apiFetch<NotebookMember>(`/notebooks/${notebookId}/members`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.members(notebookId) }),
  });
};

export const useChangeMemberRole = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, ...input }: ChangeMemberRoleInput & { userId: string }) =>
      apiFetch<void>(`/notebooks/${notebookId}/members/${userId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.members(notebookId) }),
  });
};

export const useRemoveMember = (notebookId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/notebooks/${notebookId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.members(notebookId) }),
  });
};

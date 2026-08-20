import { z } from 'zod';
import { optionalSafeText, safeText, uuidSchema } from './common.js';

export const notebookRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type NotebookRole = z.infer<typeof notebookRoleSchema>;

/** Ordered by privilege — used for `hasAtLeast` comparisons in both apps. */
export const ROLE_RANK: Record<NotebookRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export const roleAtLeast = (actual: NotebookRole, required: NotebookRole): boolean =>
  ROLE_RANK[actual] >= ROLE_RANK[required];

export const notebookSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  sourceCount: z.number().int().nonnegative(),
  /** Role of the *requesting* user; drives what the UI enables. */
  role: notebookRoleSchema,
  memberCount: z.number().int().positive().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Notebook = z.infer<typeof notebookSchema>;

export const createNotebookSchema = z.object({
  title: safeText(200),
  description: optionalSafeText(2000),
  emoji: optionalSafeText(8),
});
export type CreateNotebookInput = z.infer<typeof createNotebookSchema>;

export const updateNotebookSchema = z
  .object({
    title: safeText(200).optional(),
    description: optionalSafeText(2000),
    emoji: optionalSafeText(8),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'at least one field must be provided',
  });
export type UpdateNotebookInput = z.infer<typeof updateNotebookSchema>;

export const notebookMemberSchema = z.object({
  userId: uuidSchema,
  notebookId: uuidSchema,
  role: notebookRoleSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotebookMember = z.infer<typeof notebookMemberSchema>;

export const inviteMemberSchema = z.object({
  email: z.email().max(320),
  role: z.enum(['editor', 'viewer']),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

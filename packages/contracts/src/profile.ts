import { z } from 'zod';
import { localeSchema, safeText, themeSchema, uuidSchema } from './common.js';

export const profileSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: localeSchema,
  theme: themeSchema,
  createdAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

export const updateProfileSchema = z
  .object({
    displayName: safeText(120).optional(),
    locale: localeSchema.optional(),
    theme: themeSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'at least one field must be provided',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

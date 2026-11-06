import { z } from 'zod';
import { ROLES } from './permissions';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Password policy: 12+ chars with at least three character classes. */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .refine((pw) => {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    return classes >= 3;
  }, 'Password must contain at least three of: lowercase, uppercase, digits, symbols');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const roleSchema = z.enum(ROLES);

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  role: roleSchema,
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditQuerySchema = paginationSchema.extend({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
});

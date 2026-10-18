import { z } from 'zod';

export const roleViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  system: z.boolean(),
  editable: z.boolean(),
  userCount: z.number().int().nonnegative(),
});
export type RoleView = z.infer<typeof roleViewSchema>;
export const rolesResponseSchema = z.object({ roles: z.array(roleViewSchema) });

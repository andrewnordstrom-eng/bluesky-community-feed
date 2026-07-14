import { z } from 'zod';

export const authenticatedSessionResponseSchema = z.object({
  authenticated: z.literal(true),
  did: z.string().min(1),
  handle: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const anonymousSessionResponseSchema = z.object({
  authenticated: z.literal(false),
}).strict();

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  authenticatedSessionResponseSchema,
  anonymousSessionResponseSchema,
]);

export type AuthenticatedSessionResponse = z.infer<typeof authenticatedSessionResponseSchema>;
export type AnonymousSessionResponse = z.infer<typeof anonymousSessionResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export function parseSessionResponse(value: unknown): SessionResponse {
  return sessionResponseSchema.parse(value);
}

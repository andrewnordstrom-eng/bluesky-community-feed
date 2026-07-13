import { z } from 'zod';

const participantDidSchema = z.string().startsWith('did:').min(5);
const participantTimestampSchema = z.string().datetime({ offset: true });

export const participantSchema = z.object({
  did: participantDidSchema,
  handle: z.string().min(1).nullable(),
  added_by: z.string().min(1),
  notes: z.string().nullable(),
  added_at: participantTimestampSchema,
}).strict();

export const participantListResponseSchema = z.object({
  participants: z.array(participantSchema),
  total: z.number().int().nonnegative(),
}).strict();

export const participantAddResponseSchema = z.object({
  success: z.boolean(),
  participant: z.object({
    did: participantDidSchema,
    handle: z.string().min(1).nullable(),
    notes: z.string().nullable().optional().transform((value) => value ?? null),
  }).strict(),
}).strict();

export const participantRemoveResponseSchema = z.object({
  success: z.boolean(),
}).strict();

export type Participant = z.infer<typeof participantSchema>;

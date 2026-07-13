import { z } from "zod"

const waitlistTimestampSchema = z.string().datetime({ offset: true })

export const waitlistRequestSchema = z.object({
  id: z.number().int().positive(),
  handle: z.string().min(1),
  did: z.string().min(1).nullable(),
  note: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  created_at: waitlistTimestampSchema,
  decided_at: waitlistTimestampSchema.nullable(),
  decided_by: z.string().min(1).nullable(),
}).strict()

export const waitlistListResponseSchema = z.object({
  requests: z.array(waitlistRequestSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const waitlistApproveResponseSchema = z.object({
  success: z.boolean(),
  did: z.string().min(1),
  handle: z.string().min(1),
}).strict()

export const waitlistRejectResponseSchema = z.object({
  success: z.boolean(),
}).strict()

export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>

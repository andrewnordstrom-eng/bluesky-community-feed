/**
 * Scenario Schemas
 *
 * A `Scenario` is the harness's typed, versioned configuration surface.
 * Every entrypoint validates untrusted input with `.safeParse()` at the
 * boundary — invalid config never reaches `Simulation`. Breaking shape
 * changes get a new version (`ScenarioV2`, ...) rather than mutating V1.
 */

import { z } from 'zod';

/**
 * Config for the synthetic population a scenario seeds before running.
 *
 * `.strict()` (not the Zod-object default `.strip()`): a typo like
 * `subscriberCont` must surface as a validation error at the boundary, not
 * be silently dropped in favor of the default — that would defeat the whole
 * point of validating untrusted config before it reaches `Simulation`.
 */
export const PopulationConfigSchema = z
  .object({
    /** How many synthetic subscribers (governance voters) to seed. */
    subscriberCount: z.number().int().min(1).max(2000).default(30),
    /** How many synthetic posts to seed into the scoring window. */
    postCount: z.number().int().min(0).max(5000).default(50),
    /** Fraction of subscribers who cast a weight vote (0..1). */
    voteParticipationRate: z.number().min(0).max(1).default(0.8),
    /** Fraction of voters who additionally cast a content (keyword) vote. */
    contentVoteRate: z.number().min(0).max(1).default(0.2),
    /**
     * Fraction of participating voters who cast an actual weight opinion
     * (0..1). The remainder cast a keyword-only vote (`VoteSeed.weights:
     * null` — see population.ts).
     */
    castsWeightVoteRate: z.number().min(0).max(1).default(0.9),
  })
  .strict();
export type PopulationConfig = z.infer<typeof PopulationConfigSchema>;

const baseFields = {
  seed: z.number().int().nonnegative(),
  population: PopulationConfigSchema.default({}),
};

/**
 * ScenarioV1: the only version today. A discriminated union on `kind` so
 * new scenario shapes can be added later without breaking existing callers.
 */
export const ScenarioV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('epoch-vote-cycle'),
      version: z.literal(1),
      ...baseFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal('multi-epoch-cycle'),
      version: z.literal(1),
      /**
       * How many aggregate→transition→score cycles to run back to back.
       *
       * Reserved shape: `parseScenario()` accepts this today, but
       * `Simulation.run()` (simulation.ts) does not yet implement a
       * multi-round driver and throws rather than silently running just one
       * round. Implement the loop in `Simulation.run()` before removing that
       * guard.
       */
      rounds: z.number().int().min(1).max(20),
      ...baseFields,
    })
    .strict(),
]);

export type ScenarioV1 = z.infer<typeof ScenarioV1Schema>;

/** Current scenario type alias. Update when a `ScenarioV2` is introduced. */
export type Scenario = ScenarioV1;

export type ParseScenarioResult =
  | { success: true; data: Scenario }
  | { success: false; error: z.ZodError };

/**
 * Validate untrusted scenario input. Never throws — callers pattern-match on
 * `{ success, data } | { success: false, error }`.
 */
export function parseScenario(input: unknown): ParseScenarioResult {
  const result = ScenarioV1Schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Scenario Schemas
 *
 * A `Scenario` is the harness's typed, versioned configuration surface.
 * Every entrypoint validates untrusted input with `.safeParse()` at the
 * boundary — invalid config never reaches `Simulation`. Breaking shape
 * changes get a new version (`ScenarioV2`, ...) rather than mutating V1.
 */

import { z } from 'zod';
import { PERSONA_IDS, DEFAULT_PERSONA_MIX, type PersonaId } from './personas.js';

/**
 * Relative proportions used to assign a persona to each participating voter
 * (see `pickPersona` in personas.ts). Values are relative weights, not
 * probabilities — a weighted draw normalizes by their sum, so `{ balanced: 2,
 * 'bridge-builder': 1, ... }` just means "balanced voters are twice as
 * likely as bridge-builders", not literal percentages.
 *
 * `satisfies Record<PersonaId, z.ZodTypeAny>` (not a plain object literal):
 * gives a compile-time guarantee that this shape has exactly one field per
 * `PersonaId` — add a persona to `PERSONA_IDS` without adding it here and
 * `tsc` fails, instead of the new persona silently being undraftable.
 */
const PERSONA_MIX_SHAPE = {
  'engagement-maximizer': z.number().min(0),
  'chronological-purist': z.number().min(0),
  'bridge-builder': z.number().min(0),
  balanced: z.number().min(0),
} satisfies Record<PersonaId, z.ZodTypeAny>;

export const PersonaMixSchema = z
  .object(PERSONA_MIX_SHAPE)
  .strict()
  // `.min(0)` per field permits an all-zero mix, which parses but then throws
  // deep in `generatePopulation` → `pickPersona` ("must have at least one
  // positive weight"). Reject it here, at the scenario-validation boundary,
  // so bad config fails up front rather than mid-simulation.
  .refine((mix) => PERSONA_IDS.some((id) => mix[id] > 0), {
    message: 'personaMix must have at least one persona with a positive weight',
  });
export type PersonaMix = z.infer<typeof PersonaMixSchema>;

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
    /** Fraction of participating voters who additionally cast a topic-weight vote (0..1). */
    castsTopicVoteRate: z.number().min(0).max(1).default(0.5),
    /**
     * Relative persona mix assigned across participating voters (see
     * `PersonaMixSchema` above). Defaults to an equal mix across every
     * registered persona.
     */
    personaMix: PersonaMixSchema.default(DEFAULT_PERSONA_MIX),
  })
  .strict();
export type PopulationConfig = z.infer<typeof PopulationConfigSchema>;

// Re-exported so callers building a `PopulationConfig` (e.g. tests) can
// reference the full persona id list without a second import from
// personas.ts.
export { PERSONA_IDS };

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
       * How many aggregate→transition→score cycles `Simulation.run()`
       * (simulation.ts) drives back to back, re-seeding a fresh round of
       * persona votes each time (see `Simulation.runMultiEpochCycle`).
       *
       * Upper bound is generous (not `epoch-vote-cycle`-scale small) on
       * purpose: this scenario exists to demonstrate convergence over many
       * rounds, and a long run is only cheap because `population` stays a
       * small, fixed-size synthetic corpus reused every round — see
       * `PopulationConfigSchema.subscriberCount`/`postCount`.
       */
      rounds: z.number().int().min(1).max(1000),
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

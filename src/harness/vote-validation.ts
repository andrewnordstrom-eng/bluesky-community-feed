/**
 * Route-Equivalent Vote Validation
 *
 * `POST /api/governance/vote` (src/governance/routes/vote.ts) is the only
 * thing a real voter can ever go through, so a synthetic vote is only
 * "route-valid" if it would survive that route's exact checks:
 *   1. voter must be an active subscriber (403 Forbidden otherwise)
 *   2. no unregistered `*_weight` keys (400 UnregisteredWeightKey — PROJ-816)
 *   3. per-component weights in [min, max]; if any is present, all 5 must be
 *      and must sum to 1.0 within 0.01; keyword arrays capped at 20 entries
 *      of <=50 chars; topic weights in [0, 1] (400 InvalidVote)
 *   4. at least one of weights / keywords / topic weights must be present
 *      (400 InvalidVote)
 *   5. every topic_weights key must be a slug in topic_catalog WHERE
 *      is_active = TRUE (400 InvalidTopicSlug)
 *   6. the epoch currently accepting votes must have phase = 'voting'
 *      (409 VotingClosed)
 *
 * vote.ts's `VoteSchema` isn't exported (route-local), so this module
 * faithfully rebuilds it from the SAME registry `vote.ts` itself builds
 * from (`VOTABLE_WEIGHT_PARAMS` / `GOVERNANCE_WEIGHT_VOTE_FIELDS`) rather
 * than hardcoding the 5 field names — a 6th registered component changes
 * both schemas identically, with nothing here to fall out of sync. Every
 * function actually used to normalize an accepted vote (`normalizeWeights`,
 * `normalizeKeywords`, `votePayloadToWeights`) is imported from the real
 * production module, not reimplemented.
 *
 * Used by `Simulation.seedPopulation` (simulation.ts) as a pre-insert gate:
 * every synthetic vote runs through `validateVote` before it ever reaches
 * Postgres, so "the harness only ever writes what the real route would
 * accept" is an enforced invariant, not just a design intention.
 */

import { z } from 'zod';
import { VOTABLE_WEIGHT_PARAMS, GOVERNANCE_WEIGHT_VOTE_FIELDS } from '../config/votable-params.js';
import { normalizeWeights, normalizeKeywords, votePayloadToWeights } from '../governance/governance.types.js';
import type { VotePayload } from '../governance/governance.types.js';
import type { GovernanceWeights } from '../shared/api-types.js';

/** Mirrors vote.ts's `weightFieldSchemas`: one optional bounded number field per registered component. */
const weightFieldSchemas = Object.fromEntries(
  VOTABLE_WEIGHT_PARAMS.map((param) => [
    param.voteField,
    z.number().min(param.min).max(param.max).optional(),
  ])
) as Record<string, z.ZodOptional<z.ZodNumber>>;

/** Mirrors vote.ts's `VoteSchema` exactly (see file header for why it's rebuilt, not imported). */
const VoteBodySchema = z
  .object({
    ...weightFieldSchemas,
    include_keywords: z
      .array(z.string().max(50, 'Keywords must be 50 characters or less'))
      .max(20, 'Maximum 20 include keywords')
      .optional(),
    exclude_keywords: z
      .array(z.string().max(50, 'Keywords must be 50 characters or less'))
      .max(20, 'Maximum 20 exclude keywords')
      .optional(),
    topic_weights: z.record(z.string(), z.number().min(0).max(1)).optional(),
  })
  .refine(
    (data) => {
      const d = data as Record<string, unknown>;
      const hasAnyWeight = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => d[field] !== undefined);
      if (!hasAnyWeight) return true;

      const hasAllWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.every((field) => d[field] !== undefined);
      if (!hasAllWeights) return false;

      const sum = GOVERNANCE_WEIGHT_VOTE_FIELDS.reduce((acc, field) => acc + (d[field] as number), 0);
      return Math.abs(sum - 1.0) < 0.01;
    },
    { message: 'If weights are provided, all must be present and sum to 1.0' }
  )
  .refine(
    (data) => {
      const d = data as Record<string, unknown>;
      const hasWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => d[field] !== undefined);
      const hasKeywords =
        (data.include_keywords?.length ?? 0) > 0 || (data.exclude_keywords?.length ?? 0) > 0;
      const hasTopicWeights = Object.keys(data.topic_weights ?? {}).length > 0;
      return hasWeights || hasKeywords || hasTopicWeights;
    },
    { message: 'Must provide either weights, keywords, or topic weights (or any combination)' }
  );

/**
 * The untrusted, wire-shaped vote payload — exactly the JSON body shape
 * `POST /api/governance/vote` accepts. `[key: string]: unknown` (rather than
 * a closed interface) so negative tests can inject an unregistered
 * `*_weight` key the same way a misbehaving client could.
 */
export interface RawVotePayload {
  voterDid: string;
  include_keywords?: string[];
  exclude_keywords?: string[];
  topic_weights?: Record<string, number>;
  [weightKey: string]: unknown;
}

export interface VoteValidationContext {
  /** DIDs of active subscribers — mirrors `subscribers WHERE is_active = TRUE`. */
  subscriberDids: ReadonlySet<string>;
  /** Topic slugs currently `is_active = TRUE` in `topic_catalog`. */
  activeTopicSlugs: ReadonlySet<string>;
  /** The phase of the epoch currently open for voting. Must be `'voting'` for a vote to be accepted. */
  epochPhase: string;
}

export interface ValidatedVote {
  weights: GovernanceWeights | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  topicWeights: Record<string, number> | null;
}

export type VoteValidationResult =
  | { valid: true; data: ValidatedVote }
  | { valid: false; errors: string[] };

/**
 * Validate + normalize `payload` exactly as `POST /api/governance/vote`
 * would. Never throws — same "never throws, callers pattern-match on the
 * discriminated result" convention as `parseScenario` (scenario.ts).
 */
export function validateVote(payload: RawVotePayload, ctx: VoteValidationContext): VoteValidationResult {
  const errors: string[] = [];

  // 1. Mirrors the subscriber-membership check (403 Forbidden).
  if (!ctx.subscriberDids.has(payload.voterDid)) {
    errors.push(`voterDid "${payload.voterDid}" is not an active subscriber`);
  }

  // 2. Mirrors the PROJ-816 unregistered-weight-key guard (400 UnregisteredWeightKey).
  const registeredVoteFields = new Set(GOVERNANCE_WEIGHT_VOTE_FIELDS);
  const unregisteredWeightKeys = Object.keys(payload).filter(
    (key) => key.endsWith('_weight') && !registeredVoteFields.has(key)
  );
  if (unregisteredWeightKeys.length > 0) {
    errors.push(`Unregistered weight key(s): ${unregisteredWeightKeys.join(', ')}`);
  }

  // 3. Mirrors `VoteSchema.safeParse` (400 InvalidVote) — per-component
  // range, sum-to-1, keyword limits, topic-weight range, "at least one".
  const parseResult = VoteBodySchema.safeParse(payload);
  if (!parseResult.success) {
    errors.push(...parseResult.error.errors.map((e) => e.message));
    return { valid: false, errors };
  }
  const vote = parseResult.data;

  // 4. Mirrors the topic-slug-vs-topic_catalog.is_active check (400 InvalidTopicSlug).
  const invalidSlugs = Object.keys(vote.topic_weights ?? {}).filter(
    (slug) => !ctx.activeTopicSlugs.has(slug)
  );
  if (invalidSlugs.length > 0) {
    errors.push(`Invalid topic slugs: ${invalidSlugs.join(', ')}`);
  }

  // 5. Mirrors the epoch-phase gate (409 VotingClosed).
  if (ctx.epochPhase !== 'voting') {
    errors.push(
      `Voting is currently closed for this round (epoch phase is "${ctx.epochPhase}", not "voting")`
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Normalize exactly as the route does, via the real production helpers.
  const voteAny = vote as unknown as Record<string, unknown>;
  const hasWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => voteAny[field] !== undefined);
  let weights: GovernanceWeights | null = null;
  if (hasWeights) {
    const weightPayload = Object.fromEntries(
      GOVERNANCE_WEIGHT_VOTE_FIELDS.map((field) => [field, voteAny[field]])
    ) as unknown as VotePayload;
    weights = normalizeWeights(votePayloadToWeights(weightPayload));
  }

  const includeKeywords = normalizeKeywords(vote.include_keywords ?? []);
  const excludeKeywords = normalizeKeywords(vote.exclude_keywords ?? []);
  const topicWeights =
    vote.topic_weights && Object.keys(vote.topic_weights).length > 0 ? vote.topic_weights : null;

  return {
    valid: true,
    data: { weights, includeKeywords, excludeKeywords, topicWeights },
  };
}

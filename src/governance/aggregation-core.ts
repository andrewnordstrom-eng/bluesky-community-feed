/**
 * Vote Aggregation Core (pure, no I/O)
 *
 * The trimmed-mean weight aggregation that powers `aggregateVotes`, extracted as a
 * pure function so it can be property-tested and simulated at scale without a DB.
 * `aggregateVotes` (in aggregation.ts) fetches votes from Postgres and delegates the
 * math to `combineVoteWeights` here — keep the two in sync via the property tests.
 */

import { GovernanceWeights, normalizeWeights } from './governance.types.js';
import { GOVERNANCE_WEIGHT_VOTE_FIELDS, VOTABLE_WEIGHT_PARAMS } from '../config/votable-params.js';

const WEIGHT_COMPONENTS = GOVERNANCE_WEIGHT_VOTE_FIELDS;
type WeightComponent = (typeof WEIGHT_COMPONENTS)[number];

/** A single voter's weight ballot, keyed by DB vote-field (e.g. `recency_weight`). */
export type WeightVote = Record<WeightComponent, number>;

/** Default fraction trimmed from each end before averaging (outlier resistance). */
export const DEFAULT_TRIM_PCT = 0.1;

/** Minimum vote count at which trimming kicks in (below this, plain mean). */
export const TRIM_MIN_VOTES = 10;

/**
 * Trimmed mean of `values`: sort ascending, drop `trimCount` items from each end,
 * average the rest. Pure; does not mutate the input.
 */
export function trimmedMean(values: readonly number[], trimCount: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed =
    trimCount > 0 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
  return trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
}

/**
 * Pure trimmed-mean weight aggregation — the core of `aggregateVotes`, with no DB.
 *
 * Mirrors the production algorithm exactly: for each weight component, drop the
 * top/bottom `trimPct` (only when there are at least {@link TRIM_MIN_VOTES} votes),
 * average the remainder, then normalize the result to sum to exactly 1.0.
 *
 * @returns aggregated + normalized weights, or `null` if there are no votes.
 */
export function combineVoteWeights(
  votes: readonly WeightVote[],
  trimPct: number = DEFAULT_TRIM_PCT
): GovernanceWeights | null {
  const n = votes.length;
  if (n === 0) return null;

  const effectiveTrimCount = n >= TRIM_MIN_VOTES ? Math.floor(n * trimPct) : 0;

  const aggregated = Object.fromEntries(
    WEIGHT_COMPONENTS.map(
      (component) =>
        [component, trimmedMean(votes.map((v) => v[component]), effectiveTrimCount)] as const
    )
  ) as Record<WeightComponent, number>;

  const weights = Object.fromEntries(
    VOTABLE_WEIGHT_PARAMS.map((param) => [param.key, aggregated[param.voteField]] as const)
  ) as unknown as GovernanceWeights;

  // Normalize to ensure exact sum of 1.0.
  return normalizeWeights(weights);
}

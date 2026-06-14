/**
 * Governance simulation harness (Layer 3) — deterministic agent-based simulation.
 *
 * Synthetic voter "agents" drawn from preference distributions, plus adversarial
 * models (Sybil, strategic), run through the REAL aggregation core. Everything is
 * seeded, so runs are reproducible — these are simulations, NOT LLM agents.
 *
 * Use to answer "is the mechanism robust at scale?": does a Sybil flood flip the
 * outcome (PROJ-1048), does the trimmed mean absorb strategic outliers, etc.
 */
import { combineVoteWeights, type WeightVote } from '../../src/governance/aggregation-core.js';
import type { GovernanceWeights } from '../../src/governance/governance.types.js';

const VOTE_FIELDS = [
  'recency_weight',
  'engagement_weight',
  'bridging_weight',
  'source_diversity_weight',
  'relevance_weight',
] as const;
type VoteField = (typeof VOTE_FIELDS)[number];

/** Seeded PRNG (mulberry32) — deterministic given a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalize 5 raw positive numbers into a valid ballot (sums to 1). */
export function ballotFrom(raw: readonly [number, number, number, number, number]): WeightVote {
  const safe = raw.map((x) => Math.max(x, 1e-6));
  const s = safe.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    VOTE_FIELDS.map((f, i) => [f, safe[i] / s] as const)
  ) as Record<VoteField, number>;
}

/** A uniformly random ballot. */
export function randomBallot(rng: () => number): WeightVote {
  return ballotFrom([rng(), rng(), rng(), rng(), rng()]);
}

/** A ballot clustered around a center (Dirichlet-ish: center * exp(noise)). */
export function clusteredBallot(
  rng: () => number,
  center: readonly [number, number, number, number, number],
  spread = 0.25
): WeightVote {
  return ballotFrom(
    center.map((c) => c * Math.exp(spread * (rng() - 0.5))) as unknown as [
      number,
      number,
      number,
      number,
      number,
    ]
  );
}

export type Distribution = 'uniform' | 'clustered' | 'polarized';

/** Generate a population of honest voter ballots. */
export function generatePopulation(
  n: number,
  rng: () => number,
  dist: Distribution = 'clustered',
  center: readonly [number, number, number, number, number] = [0.25, 0.2, 0.2, 0.15, 0.2]
): WeightVote[] {
  const out: WeightVote[] = [];
  for (let i = 0; i < n; i++) {
    if (dist === 'uniform') out.push(randomBallot(rng));
    else if (dist === 'clustered') out.push(clusteredBallot(rng, center));
    else {
      // polarized: two camps pulling opposite components
      const campA: readonly [number, number, number, number, number] = [0.5, 0.1, 0.1, 0.1, 0.2];
      const campB: readonly [number, number, number, number, number] = [0.1, 0.1, 0.5, 0.1, 0.2];
      out.push(clusteredBallot(rng, rng() < 0.5 ? campA : campB, 0.15));
    }
  }
  return out;
}

/** Sybil attack: one actor casts `k` identical sockpuppet ballots. */
export function sybilSockpuppets(ballot: WeightVote, k: number): WeightVote[] {
  return Array.from({ length: k }, () => ({ ...ballot }));
}

/** A maximally one-sided ballot favoring a single component (strategic extreme). */
export function extremeBallot(field: VoteField): WeightVote {
  return ballotFrom(VOTE_FIELDS.map((f) => (f === field ? 1 : 0)) as unknown as [
    number,
    number,
    number,
    number,
    number,
  ]);
}

/** L1 distance between two weight vectors (0 = identical, 2 = max). */
export function l1Shift(a: GovernanceWeights, b: GovernanceWeights): number {
  return (
    Math.abs(a.recency - b.recency) +
    Math.abs(a.engagement - b.engagement) +
    Math.abs(a.bridging - b.bridging) +
    Math.abs(a.sourceDiversity - b.sourceDiversity) +
    Math.abs(a.relevance - b.relevance)
  );
}

/** The component with the largest adopted weight ("what the feed prioritizes"). */
export function dominantComponent(w: GovernanceWeights): keyof GovernanceWeights {
  return (Object.keys(w) as (keyof GovernanceWeights)[]).reduce((best, k) =>
    w[k] > w[best] ? k : best
  );
}

export interface ScenarioResult {
  name: string;
  voters: number;
  weights: GovernanceWeights;
  dominant: keyof GovernanceWeights;
}

/** Run an electorate through the real aggregation core. */
export function runScenario(name: string, ballots: WeightVote[]): ScenarioResult {
  const weights = combineVoteWeights(ballots);
  if (weights === null) throw new Error(`Scenario "${name}" has no votes`);
  return { name, voters: ballots.length, weights, dominant: dominantComponent(weights) };
}

export interface BreakEven {
  /** Smallest sockpuppet count that flips the dominant component, or null if it never flips up to maxK. */
  breakEvenK: number | null;
  /** breakEvenK as a fraction of the resulting (honest + sybil) electorate, or null. */
  breakEvenPct: number | null;
  baselineDominant: keyof GovernanceWeights;
}

/**
 * Sweep sockpuppet counts to find the smallest Sybil flood that flips the adopted
 * dominant component away from the honest baseline. Deterministic given `honest`.
 */
export function sybilBreakEven(
  honest: WeightVote[],
  attacker: WeightVote,
  maxK: number = honest.length
): BreakEven {
  const baseline = combineVoteWeights(honest);
  if (baseline === null) throw new Error('sybilBreakEven: empty honest electorate');
  const baselineDominant = dominantComponent(baseline);
  for (let k = 1; k <= maxK; k++) {
    const w = combineVoteWeights([...honest, ...sybilSockpuppets(attacker, k)])!;
    if (dominantComponent(w) !== baselineDominant) {
      return { breakEvenK: k, breakEvenPct: k / (honest.length + k), baselineDominant };
    }
  }
  return { breakEvenK: null, breakEvenPct: null, baselineDominant };
}

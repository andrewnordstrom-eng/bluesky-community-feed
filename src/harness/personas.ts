/**
 * Synthetic Voter Personas
 *
 * A1's `generatePopulation` (population.ts) drew every voter's weight vector
 * uniformly at random — realistic enough to exercise the pipeline, but not
 * representative of how a real community actually votes: real voters cluster
 * around a handful of recognizable strategies ("I only care about fresh
 * posts", "show me what's popular", "surface bridging content"). PROJ-1483/A2
 * replaces the uniform draw with a small set of scripted personas so
 * `aggregateVotes`'s trimmed-mean math has a realistic, clustered input
 * distribution to run against instead of noise.
 *
 * Every persona strategy is a pure function of an injected `Rng` — same seed,
 * same persona, same output — so population.ts's determinism guarantee
 * extends to persona-driven votes without any extra bookkeeping.
 */

import type { Rng } from './rng.js';
import { normalizeWeights } from '../governance/governance.types.js';
import type { GovernanceWeights } from '../shared/api-types.js';

export const PERSONA_IDS = [
  'engagement-maximizer',
  'chronological-purist',
  'bridge-builder',
  'balanced',
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export interface Persona {
  readonly id: PersonaId;
  /**
   * Draws one raw (pre-normalization) weight vector for this persona.
   * Deterministic given `rng` — always consumes exactly 5 `rng.next()`
   * calls (recency, engagement, bridging, sourceDiversity, relevance, in
   * that fixed order — matching `VOTABLE_WEIGHT_PARAMS`) regardless of
   * which persona this is, so swapping personas never shifts the RNG
   * sequence downstream callers see.
   */
  readonly weightPolicy: (rng: Rng) => GovernanceWeights;
  /**
   * Topic slugs this persona has above-baseline affinity for. Read by
   * `castPersonaVote` to bias that persona's topic-weight votes; has no
   * effect on component weight voting.
   */
  readonly topicAffinities: readonly string[];
}

/** Max absolute deviation applied to a persona's base weight/topic value is `spread / 2`. */
const WEIGHT_JITTER_SPREAD = 0.1;
const TOPIC_JITTER_SPREAD = 0.2;
const TOPIC_AFFINITY_BASE = 0.7;
const TOPIC_BASELINE_BASE = 0.25;
/** Decimal places topic-weight votes are rounded to (matches `aggregateTopicWeights`'s output rounding). */
const TOPIC_WEIGHT_SCALE = 1000;

function jitter(rng: Rng, base: number, spread: number): number {
  return base + (rng.next() - 0.5) * spread;
}

/**
 * Build a `weightPolicy` that jitters a fixed base vector. The base vectors
 * below are chosen so that, even at maximum jitter, the persona's signature
 * component still dominates the raw (pre-normalization) vector — see the
 * "dominant component" test in personas.sim.test.ts.
 */
function makeWeightPolicy(base: GovernanceWeights): (rng: Rng) => GovernanceWeights {
  return (rng: Rng): GovernanceWeights => ({
    recency: jitter(rng, base.recency, WEIGHT_JITTER_SPREAD),
    engagement: jitter(rng, base.engagement, WEIGHT_JITTER_SPREAD),
    bridging: jitter(rng, base.bridging, WEIGHT_JITTER_SPREAD),
    sourceDiversity: jitter(rng, base.sourceDiversity, WEIGHT_JITTER_SPREAD),
    relevance: jitter(rng, base.relevance, WEIGHT_JITTER_SPREAD),
  });
}

export const PERSONAS: Record<PersonaId, Persona> = {
  'engagement-maximizer': {
    id: 'engagement-maximizer',
    weightPolicy: makeWeightPolicy({
      recency: 0.05,
      engagement: 0.7,
      bridging: 0.05,
      sourceDiversity: 0.05,
      relevance: 0.15,
    }),
    topicAffinities: ['sports', 'music'],
  },
  'chronological-purist': {
    id: 'chronological-purist',
    weightPolicy: makeWeightPolicy({
      recency: 0.7,
      engagement: 0.05,
      bridging: 0.05,
      sourceDiversity: 0.05,
      relevance: 0.15,
    }),
    topicAffinities: ['politics'],
  },
  'bridge-builder': {
    id: 'bridge-builder',
    weightPolicy: makeWeightPolicy({
      recency: 0.05,
      engagement: 0.05,
      bridging: 0.7,
      sourceDiversity: 0.15,
      relevance: 0.05,
    }),
    topicAffinities: ['science', 'software-development'],
  },
  balanced: {
    id: 'balanced',
    weightPolicy: makeWeightPolicy({
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    }),
    topicAffinities: [],
  },
};

/**
 * Relative proportions used to assign a persona to each participating voter
 * (see `pickPersona`). Values are relative weights, not probabilities — they
 * don't need to sum to 1. Equal mix by default: no persona dominates the
 * synthetic electorate unless a scenario config opts into a skew.
 */
export const DEFAULT_PERSONA_MIX: Record<PersonaId, number> = {
  'engagement-maximizer': 1,
  'chronological-purist': 1,
  'bridge-builder': 1,
  balanced: 1,
};

/**
 * Deterministically pick a persona for one voter, weighted by `mix`.
 * Consumes exactly one `rng.next()` call. Iterates `PERSONA_IDS` in its
 * fixed declaration order (not `Object.keys(mix)`) so the cumulative-weight
 * bucketing is stable regardless of how the caller's `mix` object was built.
 */
export function pickPersona(rng: Rng, mix: Readonly<Record<PersonaId, number>>): Persona {
  const total = PERSONA_IDS.reduce((sum, id) => sum + mix[id], 0);
  if (!(total > 0)) {
    throw new Error('pickPersona: personaMix must have at least one positive weight');
  }

  const draw = rng.next() * total;
  let cumulative = 0;
  for (const id of PERSONA_IDS) {
    cumulative += mix[id];
    if (draw < cumulative) {
      return PERSONAS[id];
    }
  }
  // Only reachable via floating-point rounding landing `draw` exactly on
  // `total` — fall back to the last persona rather than returning undefined.
  return PERSONAS[PERSONA_IDS[PERSONA_IDS.length - 1]];
}

export interface PersonaVote {
  /** Normalized (sum-to-1, real `normalizeWeights`) component weight vote. */
  weights: GovernanceWeights;
  /** Topic slug -> weight, one entry per slug in `topicSlugs`. */
  topicWeights: Record<string, number>;
}

/**
 * Draw one full persona-driven vote: a normalized component weight vector
 * plus a topic-weight vote over `topicSlugs`. Always draws both parts (5
 * `rng.next()` calls for weights, one more per topic slug) regardless of
 * whether the caller ultimately uses them — mirrors population.ts's existing
 * "always draw" convention so the RNG sequence for later voters doesn't shift
 * based on a participation rate.
 *
 * Topics in `persona.topicAffinities` get a higher jittered base value than
 * topics the persona has no particular affinity for; every slug in
 * `topicSlugs` gets an entry either way (callers that only want a subset —
 * e.g. a voter who didn't cast a topic-weight opinion — should discard this
 * result rather than pass a partial `topicSlugs` list, to keep draw counts
 * stable).
 */
export function castPersonaVote(
  rng: Rng,
  persona: Persona,
  topicSlugs: readonly string[]
): PersonaVote {
  const weights = normalizeWeights(persona.weightPolicy(rng));

  const topicWeights: Record<string, number> = {};
  for (const slug of topicSlugs) {
    const base = persona.topicAffinities.includes(slug) ? TOPIC_AFFINITY_BASE : TOPIC_BASELINE_BASE;
    const value = Math.min(1, Math.max(0, jitter(rng, base, TOPIC_JITTER_SPREAD)));
    topicWeights[slug] = Math.round(value * TOPIC_WEIGHT_SCALE) / TOPIC_WEIGHT_SCALE;
  }

  return { weights, topicWeights };
}

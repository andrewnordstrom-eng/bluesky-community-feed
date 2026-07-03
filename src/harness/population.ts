/**
 * Population Generation
 *
 * Pure, deterministic generation of a synthetic community: subscribers
 * (governance voters), posts (with engagement counts), and votes. Takes an
 * injected `Rng`/`Clock` and a validated `PopulationConfig` — never reads
 * `Math.random()`/`Date.now()` itself, so the same `(seed, config)` always
 * produces byte-identical output.
 *
 * This module does no I/O. Seeding the generated population into
 * Postgres/Redis is `Simulation`'s job (src/harness/simulation.ts) — keeping
 * "generate" and "drive" separate lets population shapes be unit-tested with
 * zero database dependency.
 */

import type { Rng, Clock } from './rng.js';
import type { PopulationConfig } from './scenario.js';
import { castPersonaVote, pickPersona } from './personas.js';
import type { GovernanceWeights } from '../shared/api-types.js';

const SCORING_WINDOW_MS = 72 * 60 * 60 * 1000;
const SAMPLE_KEYWORDS = ['news', 'sports', 'tech', 'art', 'music', 'science'] as const;
const SAMPLE_EXCLUDE_KEYWORDS = ['spam', 'nsfw'] as const;

/**
 * The exact topic slugs this harness generates content and votes for.
 * Exported so `Simulation.seedPopulation` (simulation.ts) can register
 * these SAME slugs as active rows in `topic_catalog` — persona topic-weight
 * votes are only "route-valid" (see vote-validation.ts) against whatever
 * set the harness itself registers as active, so the two must stay in sync
 * by construction rather than by convention.
 */
export const TOPIC_SLUGS = ['software-development', 'sports', 'music', 'science', 'politics'] as const;

export interface SubscriberSeed {
  did: string;
}

export interface PostSeed {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  createdAt: Date;
  hasMedia: boolean;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  embedUrl: string | null;
  topicVector: Record<string, number>;
}

export interface VoteSeed {
  voterDid: string;
  /** null = a keyword-only vote (no weight opinion cast). */
  weights: GovernanceWeights | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  /** Topic slug -> weight. Empty = no topic-weight opinion cast this epoch. */
  topicWeights: Record<string, number>;
}

export interface Population {
  subscribers: SubscriberSeed[];
  posts: PostSeed[];
  votes: VoteSeed[];
}

function padIndex(index: number): string {
  return String(index).padStart(6, '0');
}

function generateSubscribers(count: number): SubscriberSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    did: `did:plc:corgisimsub${padIndex(index)}`,
  }));
}

/** Deterministic Fisher-Yates shuffle of indices [0, count), driven by `rng`. */
function shuffledIndices(rng: Rng, count: number): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function generatePosts(
  rng: Rng,
  clock: Clock,
  count: number,
  authorDids: readonly string[]
): PostSeed[] {
  const nowMs = clock.now().getTime();

  return Array.from({ length: count }, (_, index) => {
    const author = authorDids[index % authorDids.length];
    const ageMs = rng.int(SCORING_WINDOW_MS);
    // Subtract `index` ms too so no two posts share an exact timestamp —
    // avoids ORDER BY created_at DESC tie-breaking ambiguity downstream.
    const createdAt = new Date(nowMs - ageMs - index);

    const topicVector: Record<string, number> = {};
    const topicCount = rng.int(3); // 0, 1, or 2 topics
    for (let t = 0; t < topicCount; t++) {
      const slug = rng.pick(TOPIC_SLUGS);
      topicVector[slug] = Math.round(rng.next() * 1000) / 1000;
    }

    return {
      uri: `at://${author}/app.bsky.feed.post/corgisimpost${padIndex(index)}`,
      cid: `bafycorgisim${padIndex(index)}`,
      authorDid: author,
      text: `Simulated post #${index} about ${rng.pick(SAMPLE_KEYWORDS)}`,
      createdAt,
      hasMedia: rng.chance(0.1),
      likeCount: rng.int(50),
      repostCount: rng.int(20),
      replyCount: rng.int(10),
      embedUrl: rng.chance(0.15) ? `https://example.test/article/${rng.int(20)}` : null,
      topicVector,
    };
  });
}

/**
 * Draw one round of persona votes over a FIXED subscriber set — votes only, no
 * subscribers/posts. Used by the multi-epoch harness to re-draw each round's
 * votes without consuming post-generation RNG (which would couple later-round
 * votes to `postCount`). Deterministic given `rng` + `config`.
 */
export function generateVotes(
  rng: Rng,
  subscribers: readonly SubscriberSeed[],
  config: PopulationConfig
): VoteSeed[] {
  const voterCount = Math.round(subscribers.length * config.voteParticipationRate);
  const participantOrder = shuffledIndices(rng, subscribers.length).slice(0, voterCount);

  return participantOrder.map((subscriberIndex) => {
    const subscriber = subscribers[subscriberIndex];
    const castsWeightVote = rng.chance(config.castsWeightVoteRate);
    // Always draw so the deterministic RNG sequence (and the weighted/null-vote
    // pattern) stays stable regardless of this rule. A voter with no weight
    // opinion (weights: null) must still carry at least one keyword — otherwise
    // it is a no-op vote (no weight opinion AND no content opinion), which the
    // real API would never accept. So keyword-only voters always cast content.
    const drawsContentVote = rng.chance(config.contentVoteRate);
    const castsContentVote = castsWeightVote ? drawsContentVote : true;
    const castsTopicVote = rng.chance(config.castsTopicVoteRate);

    // Every participating voter is assigned a persona, then casts a full
    // persona-driven vote (component weights + topic weights) — always, via
    // `castPersonaVote`, regardless of `castsWeightVote`/`castsTopicVote` —
    // so the RNG sequence downstream voters see never shifts based on those
    // rates (same "always draw" convention as `drawsContentVote` above).
    // Only afterwards do the participation gates decide which parts of that
    // draw actually become this voter's `VoteSeed`.
    const persona = pickPersona(rng, config.personaMix);
    const personaVote = castPersonaVote(rng, persona, TOPIC_SLUGS);

    // Keyword-only voters (VoteSeed.weights: null) never surface a weight
    // vector at all — this is the only place `weights: null` is ever
    // produced, mirroring the real API's "cast keywords without a weight
    // opinion" shape. `castPersonaVote` already normalized through the REAL
    // `normalizeWeights` production helper, so every weighted vote satisfies
    // the same sum-to-1 invariant the API layer enforces.
    const weights = castsWeightVote ? personaVote.weights : null;
    const topicWeights = castsTopicVote ? personaVote.topicWeights : {};

    const includeKeywords = castsContentVote && rng.chance(0.5) ? [rng.pick(SAMPLE_KEYWORDS)] : [];
    const excludeKeywords = castsContentVote ? [rng.pick(SAMPLE_EXCLUDE_KEYWORDS)] : [];

    return {
      voterDid: subscriber.did,
      weights,
      includeKeywords,
      excludeKeywords,
      topicWeights,
    };
  });
}

/**
 * Generate a full synthetic population for a scenario run. Pure function of
 * `(rng, clock, config)` — same inputs always produce the same output.
 */
export function generatePopulation(rng: Rng, clock: Clock, config: PopulationConfig): Population {
  const subscribers = generateSubscribers(config.subscriberCount);
  const authorDids = subscribers.length > 0 ? subscribers.map((s) => s.did) : ['did:plc:corgisimfallbackauthor'];
  const posts = generatePosts(rng, clock, config.postCount, authorDids);
  const votes = generateVotes(rng, subscribers, config);

  return { subscribers, posts, votes };
}

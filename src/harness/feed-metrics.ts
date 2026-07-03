/**
 * Feed-Space Metrics (A5 / PROJ-1486)
 *
 * `convergence.ts` measures governance in WEIGHT space (how far did the
 * 5-component vector move). This module measures governance in FEED space —
 * what a subscriber actually sees once a weight vector has been scored into a
 * ranked list of posts. Every function here is pure: given a ranked feed (and,
 * for the topic/author metrics, the `posts` rows those URIs join to), it
 * returns a number or a small summary object. No I/O, no Postgres/Redis, no
 * `Rng`/`Clock` — `baseline-comparison.ts` is the "drive" half that produces
 * the feeds these functions measure, mirroring the harness's existing
 * drive/measure split (simulation.ts vs metrics.ts / convergence.ts).
 *
 * Four metrics, all defined over a feed's top-K post URIs plus the
 * `topic_vector/author_did` each URI joins to on `posts`:
 *
 *   - **rank churn**: how different are two regimes' rankings of the SAME
 *     post set? `normalizedRankDisplacement` (average absolute rank-position
 *     change, over the shared/intersected post set, normalized to [0, 1]) and
 *     `kendallTauDistance` (fraction of pairwise orderings that disagree) are
 *     both provided — the former is easy to read ("how far did posts move on
 *     average"), the latter is the standard rank-correlation distance.
 *
 *   - **minority-topic exposure**: `minorityTopicExposure` — the share of a
 *     feed whose DOMINANT topic (the highest-weight entry in its
 *     `topic_vector`, ties broken by topic slug for determinism) is a
 *     low-support ("tail") topic, where "low-support" is defined relative to
 *     a caller-supplied corpus-wide topic distribution (not the feed itself —
 *     see the function doc for why).
 *
 *   - **author concentration**: `authorHHI` (Herfindahl-Hirschman Index) and
 *     `authorGini` (Gini coefficient) over the feed's `author_did` shares —
 *     two standard, complementary concentration measures over the same
 *     distribution (HHI is sum-of-squared-shares, sensitive to a single
 *     dominant author; Gini is a full-distribution inequality measure).
 *
 *   - **distortion ratio**: `distortionRatio` — see that function's doc for
 *     the exact definition and what it is bounded to claim.
 *
 * Every metric here is a bounded, corpus-relative measurement: a number
 * computed against ONE fixed synthetic corpus and a specific pair/set of
 * regimes, not a universal claim about governance vs. engagement optimization
 * in general. See `baseline-comparison.ts`'s file header for the actual
 * three-regime results measured with these functions.
 */

/** Minimal shape this module needs from a ranked feed entry — matches
 *  `TopScoredPost` (simulation.ts) structurally without importing it, so this
 *  module stays free of any Postgres/Redis-touching import chain. */
export interface FeedEntry {
  uri: string;
  rank: number;
}

/** Minimal shape this module needs from a `posts` row for the topic/author
 *  metrics — a subset of `PostSeed` (population.ts), read back from Postgres
 *  by `baseline-comparison.ts` rather than reused from the generator, since
 *  the metrics here operate on whatever is actually in the `posts` table. */
export interface FeedPostInfo {
  uri: string;
  authorDid: string;
  /** Topic slug -> weight, exactly as stored in `posts.topic_vector` (JSONB).
   *  Empty object = no topic classified for this post. */
  topicVector: Record<string, number>;
}

function assertNonEmpty(feed: readonly FeedEntry[], fnName: string): void {
  if (feed.length === 0) {
    throw new Error(`${fnName}: feed must be non-empty`);
  }
}

// ============================================================================
// Rank churn
// ============================================================================

/**
 * Average absolute rank-position displacement of posts appearing in BOTH
 * `feedA` and `feedB`, normalized to [0, 1] by the shared set's size (so a
 * post that moved from rank 1 to the very last shared rank contributes
 * displacement 1, not a raw integer that depends on K).
 *
 * Only the INTERSECTION of the two feeds' post sets is scored — a post
 * present in one regime's top-K but absent from the other's has no rank in
 * the other feed to compare against, so it is excluded from the displacement
 * average rather than assigned an arbitrary penalty. `sharedCount` is
 * returned alongside the score so a caller can see how much of the feed the
 * average was actually computed over (two feeds that barely overlap will
 * have a small `sharedCount` and a less meaningful churn score — this is
 * reported, not hidden).
 *
 * Throws if either feed is empty, or if the two feeds share no posts at all
 * (displacement over an empty intersection has no meaningful value).
 */
export function normalizedRankDisplacement(
  feedA: readonly FeedEntry[],
  feedB: readonly FeedEntry[]
): { displacement: number; sharedCount: number } {
  assertNonEmpty(feedA, 'normalizedRankDisplacement');
  assertNonEmpty(feedB, 'normalizedRankDisplacement');

  const rankB = new Map(feedB.map((entry) => [entry.uri, entry.rank]));
  const shared: Array<{ rankA: number; rankB: number }> = [];
  for (const entry of feedA) {
    const b = rankB.get(entry.uri);
    if (b !== undefined) {
      shared.push({ rankA: entry.rank, rankB: b });
    }
  }

  if (shared.length === 0) {
    throw new Error(
      'normalizedRankDisplacement: feedA and feedB share no posts — displacement is undefined over an empty intersection'
    );
  }

  // Normalize each pair's displacement by the larger feed's max rank, so the
  // per-pair contribution is always in [0, 1] regardless of K.
  const maxRank = Math.max(...feedA.map((e) => e.rank), ...feedB.map((e) => e.rank));
  const totalDisplacement = shared.reduce(
    (sum, { rankA, rankB: rb }) => sum + Math.abs(rankA - rb) / maxRank,
    0
  );

  return {
    displacement: totalDisplacement / shared.length,
    sharedCount: shared.length,
  };
}

/**
 * Normalized Kendall-tau distance between two rankings, restricted to their
 * shared post set: the fraction of pairs (among the shared posts) that
 * `feedA` and `feedB` order differently, in [0, 1]. 0 = identical relative
 * order over the shared set; 1 = completely reversed order.
 *
 * This is the standard rank-correlation distance (bubble-sort-swap-count /
 * total pairs) and is a genuinely different signal from
 * `normalizedRankDisplacement`: two feeds can have small average
 * displacement but many local pairwise swaps (e.g. an adjacent-pair
 * shuffle throughout), or large displacement concentrated in a few posts
 * that moved a long way while everything else's relative order held. Both
 * numbers are reported so a reader isn't left with only one lens.
 *
 * O(n^2) over the shared set — fine at this harness's K (<= a few hundred);
 * not intended for web-scale rankings.
 */
export function kendallTauDistance(feedA: readonly FeedEntry[], feedB: readonly FeedEntry[]): number {
  assertNonEmpty(feedA, 'kendallTauDistance');
  assertNonEmpty(feedB, 'kendallTauDistance');

  const rankBByUri = new Map(feedB.map((entry) => [entry.uri, entry.rank]));
  const shared = feedA
    .filter((entry) => rankBByUri.has(entry.uri))
    .map((entry) => ({ uri: entry.uri, rankA: entry.rank, rankB: rankBByUri.get(entry.uri)! }));

  if (shared.length < 2) {
    throw new Error(
      `kendallTauDistance: needs at least 2 shared posts to compare pairwise order, got ${shared.length}`
    );
  }

  let discordant = 0;
  let totalPairs = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      totalPairs++;
      const signA = Math.sign(shared[i].rankA - shared[j].rankA);
      const signB = Math.sign(shared[i].rankB - shared[j].rankB);
      // signA/signB are never 0: two distinct feed entries never share a rank
      // (rank is a 1..K position, unique per feed) — a same-sign comparison is
      // "concordant" (both feeds agree on relative order), opposite-sign is
      // "discordant".
      if (signA !== signB) {
        discordant++;
      }
    }
  }

  return discordant / totalPairs;
}

// ============================================================================
// Minority-topic exposure
// ============================================================================

/**
 * The dominant topic slug of a post's `topic_vector` — the entry with the
 * highest weight, ties broken by ascending slug name for determinism (two
 * topics can legitimately tie at the same jittered/rounded weight — see
 * population.ts's topic generation — so an arbitrary `Object.entries` order
 * must not decide the winner). Returns `null` for a post with an empty
 * `topic_vector` (no topic classified).
 */
export function dominantTopic(topicVector: Record<string, number>): string | null {
  const entries = Object.entries(topicVector);
  if (entries.length === 0) {
    return null;
  }
  entries.sort(([slugA, weightA], [slugB, weightB]) => {
    if (weightB !== weightA) {
      return weightB - weightA;
    }
    return slugA < slugB ? -1 : slugA > slugB ? 1 : 0;
  });
  return entries[0][0];
}

/**
 * Share of `feed`'s posts whose dominant topic is a "tail" (low-support)
 * topic, per `corpusTopicSupport` — a slug -> post-count (or share) map
 * describing how common each topic is ACROSS THE WHOLE CORPUS the feed was
 * ranked from, not just within the feed itself.
 *
 * Corpus-relative (not feed-relative) support is deliberate: "minority topic"
 * describes a topic that is rare in the community's content overall — a topic
 * that happens to be rare in one particular feed but common in the corpus
 * would not be a meaningful minority-exposure signal, and computing support
 * from the feed alone would make the metric circular (a feed that already
 * excludes a topic entirely would trivially show 0% exposure to it, which is
 * the opposite of what "exposure" should mean here).
 *
 * `tailThreshold` (share of corpus posts, e.g. 0.1) marks a topic as "tail"
 * when its corpus-wide share is strictly below the threshold. Posts with no
 * dominant topic (`dominantTopic` returns null) are excluded from both the
 * numerator and denominator — an unclassified post has no topic to be a
 * minority or majority member of.
 */
export function minorityTopicExposure(
  feed: readonly FeedPostInfo[],
  corpusTopicSupport: Readonly<Record<string, number>>,
  tailThreshold: number
): { exposure: number; classifiedCount: number; totalCount: number } {
  if (tailThreshold < 0 || tailThreshold > 1) {
    throw new Error(`minorityTopicExposure: tailThreshold must be in [0, 1], got ${tailThreshold}`);
  }

  const totalCorpusPosts = Object.values(corpusTopicSupport).reduce((sum, count) => sum + count, 0);
  const tailSlugs = new Set(
    Object.entries(corpusTopicSupport)
      .filter(([, count]) => (totalCorpusPosts === 0 ? false : count / totalCorpusPosts < tailThreshold))
      .map(([slug]) => slug)
  );

  let classifiedCount = 0;
  let minorityCount = 0;
  for (const post of feed) {
    const topic = dominantTopic(post.topicVector);
    if (topic === null) {
      continue;
    }
    classifiedCount++;
    if (tailSlugs.has(topic)) {
      minorityCount++;
    }
  }

  return {
    exposure: classifiedCount === 0 ? 0 : minorityCount / classifiedCount,
    classifiedCount,
    totalCount: feed.length,
  };
}

/**
 * Build a corpus-wide topic-support map (slug -> post count, by dominant
 * topic) from the full corpus's posts — the input `minorityTopicExposure`
 * expects for its `corpusTopicSupport` parameter. Separate from that function
 * so a caller with a pre-computed support map (e.g. from a DB aggregate
 * query) can skip this and pass their own.
 */
export function buildCorpusTopicSupport(corpusPosts: readonly FeedPostInfo[]): Record<string, number> {
  const support: Record<string, number> = {};
  for (const post of corpusPosts) {
    const topic = dominantTopic(post.topicVector);
    if (topic === null) {
      continue;
    }
    support[topic] = (support[topic] ?? 0) + 1;
  }
  return support;
}

// ============================================================================
// Author concentration
// ============================================================================

/** Author -> share of `feed` (post count / feed length), for `feed`'s
 *  non-empty post set. Shared by `authorHHI`/`authorGini` so both operate
 *  over the identical distribution. */
function authorShares(feed: readonly FeedPostInfo[]): number[] {
  const counts = new Map<string, number>();
  for (const post of feed) {
    counts.set(post.authorDid, (counts.get(post.authorDid) ?? 0) + 1);
  }
  return [...counts.values()].map((count) => count / feed.length);
}

/**
 * Herfindahl-Hirschman Index over a feed's `author_did` distribution: the sum
 * of squared per-author shares, in (0, 1]. Standard concentration measure
 * (same definition used for market-share concentration) — higher means fewer
 * authors dominate the feed. A feed of N posts by N distinct authors has HHI
 * `1/N` (minimum possible concentration for that N); a feed entirely from one
 * author has HHI 1 (maximum).
 */
export function authorHHI(feed: readonly FeedPostInfo[]): number {
  if (feed.length === 0) {
    throw new Error('authorHHI: feed must be non-empty');
  }
  return authorShares(feed).reduce((sum, share) => sum + share * share, 0);
}

/**
 * Gini coefficient over a feed's `author_did` distribution (post counts per
 * author), in [0, 1). 0 = every author in the feed has an identical post
 * count (perfect equality); approaches 1 as the feed concentrates on fewer
 * and fewer authors. Computed via the standard mean-absolute-difference form
 * (mean pairwise absolute difference between shares, divided by twice the
 * mean share) rather than a sorted-cumulative-share approximation, so it is
 * exact (not a discretization) for a finite author list.
 *
 * A feed with only one distinct author is a degenerate case (no inequality
 * to measure between authors — there's only one) and returns 0 rather than
 * dividing by a zero mean-absolute-difference denominator ambiguously; this
 * is called out explicitly rather than silently producing `NaN`.
 */
export function authorGini(feed: readonly FeedPostInfo[]): number {
  if (feed.length === 0) {
    throw new Error('authorGini: feed must be non-empty');
  }
  const shares = authorShares(feed);
  if (shares.length === 1) {
    return 0;
  }

  let sumAbsDiff = 0;
  for (let i = 0; i < shares.length; i++) {
    for (let j = 0; j < shares.length; j++) {
      sumAbsDiff += Math.abs(shares[i] - shares[j]);
    }
  }
  const n = shares.length;
  const mean = shares.reduce((sum, s) => sum + s, 0) / n;
  const meanAbsDiff = sumAbsDiff / (n * n);
  return meanAbsDiff / (2 * mean);
}

// ============================================================================
// Distortion ratio
// ============================================================================

/**
 * Distortion ratio of a `treatment` feed relative to a `reference` feed, over
 * a shared quality proxy: the reference feed's OWN total_score for each post
 * (i.e. "how good does the reference regime think these posts are"), summed
 * over the treatment feed's top-K post set and normalized by the reference
 * feed's own top-K total.
 *
 * Concretely: `sum(referenceScoreByUri[uri] for uri in treatmentFeed top-K) /
 * sum(referenceScoreByUri[uri] for uri in referenceFeed top-K)`.
 *
 * This answers "if we score the TREATMENT regime's chosen posts using the
 * REFERENCE regime's own quality function, how much of the reference
 * regime's own best-case score do we still capture?" A ratio of 1.0 means the
 * treatment feed's posts are, by the reference's own yardstick, exactly as
 * good as what the reference itself would have chosen (even if the actual
 * post SET differs) — 0.7 means it captures 70% of that reference-defined
 * "quality mass". A post the treatment feed included that the reference feed
 * never scored at all (not in `referenceScoreByUri`) contributes 0 to the
 * numerator, not an error — that post simply has no reference-defined
 * quality contribution.
 *
 * Bounded framing (see baseline-comparison.ts's header for the actual
 * numbers): this is ONE way to operationalize "welfare cost", and it is only
 * as meaningful as the reference regime's own scoring function is a good
 * quality proxy — it is not an independent ground-truth utility measure. When
 * `reference` is the engagement-only regime, this ratio is read as "how much
 * of the engagement-maximizer's own best-case engagement-quality does the
 * governed feed still capture" — the "at what cost" half of the A5 question.
 * A ratio near 1 says "governance cost little engagement-quality by the
 * engagement regime's own yardstick"; a ratio well below 1 says the two
 * regimes are optimizing for substantially different post sets.
 */
export function distortionRatio(
  treatment: readonly FeedEntry[],
  reference: readonly FeedEntry[],
  referenceScoreByUri: ReadonlyMap<string, number>
): number {
  assertNonEmpty(treatment, 'distortionRatio');
  assertNonEmpty(reference, 'distortionRatio');

  const referenceTotal = reference.reduce((sum, entry) => sum + (referenceScoreByUri.get(entry.uri) ?? 0), 0);
  if (referenceTotal === 0) {
    throw new Error(
      'distortionRatio: reference feed\'s own total quality mass is 0 — ratio is undefined (division by zero). ' +
        'This means every reference-feed post scored 0 or is missing from referenceScoreByUri.'
    );
  }

  const treatmentTotal = treatment.reduce(
    (sum, entry) => sum + (referenceScoreByUri.get(entry.uri) ?? 0),
    0
  );

  return treatmentTotal / referenceTotal;
}

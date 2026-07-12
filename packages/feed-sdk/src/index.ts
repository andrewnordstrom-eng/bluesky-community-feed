/**
 * @corgi/feed-sdk — Public type contract for custom scoring components.
 *
 * This package is the importable surface for third-party scoring component
 * authors who want to extend the bluesky-community-feed without forking the
 * monolith.
 *
 * The shapes here are intentionally minimal — just enough type information to
 * implement a component, write a unit test against the contract, and have the
 * implementation drop cleanly into the live registry.
 *
 * See `docs/adr/ADR-0001-extensible-scoring-components.md` for the architectural
 * rationale, and `docs/contributing-scoring-components.md` (PROJ-820 / P7) for
 * the end-to-end contribution flow.
 */

// ────────────────────────────────────────────────────────────────────────────
// Component contract
// ────────────────────────────────────────────────────────────────────────────

/**
 * A pluggable scoring component.
 *
 * Implementations return a 0.0–1.0 score for a single post. The runtime score
 * is multiplied by the community-voted weight for the component's `key`, so
 * unbounded values would break the per-component decomposition contract.
 */
export interface ScoringComponent {
  /** Stable identifier; must be in the registered set known to the server. */
  readonly key: string;
  /** Human-readable name for logs, transparency UIs, and audit explanations. */
  readonly name: string;
  /** Score the post in 0..1. */
  score(post: PostForScoring, context: ScoringContext): Promise<number>;
  /** Optional efficient scoring path for one immutable candidate batch. */
  scoreBatch?(
    posts: readonly PostForScoring[],
    context: ScoringContext
  ): Promise<ReadonlyMap<PostForScoring, number>>;
}

/**
 * Shared context passed to all components in a single scoring run.
 * Mutable fields (e.g. `authorCounts`) are intentional — components like
 * source-diversity coordinate across the run.
 */
export interface ScoringContext {
  readonly epoch: GovernanceEpoch;
  readonly scoringWindowHours: number;
  /** Immutable ranking clock. Required by coherent ranking runs. */
  readonly asOf?: Date;
  /** Mutable map shared across components in a single run. */
  readonly authorCounts: Map<string, number>;
}

/** A governed slate-level objective evaluated during final selection. */
export interface SlateReranker<TInput, TOutput> {
  readonly key: string;
  rerank(items: readonly TInput[], limit: number): readonly TOutput[];
}

// ────────────────────────────────────────────────────────────────────────────
// Score shape
// ────────────────────────────────────────────────────────────────────────────

/** Per-component score map: component_key → 0..1 value. */
export type ScoreComponents = Record<string, number>;

/**
 * Complete score decomposition for a post.
 *
 * GOLDEN RULE: every ranking decision is decomposed and persisted —
 * raw, weight, and weighted are all stored so explanations and counterfactuals
 * remain possible. See `docs/PRD.md` (transparency section).
 */
export interface WeightedScore {
  /** Raw component scores (0.0–1.0). */
  raw: ScoreComponents;
  /** Weights from the current governance epoch. Sum to 1.0 (tolerance 0.01). */
  weights: ScoreComponents;
  /** Weighted values (raw × weight). */
  weighted: ScoreComponents;
  /** Final combined score (sum of weighted values). */
  total: number;
}

/** A post with its computed score. */
export interface ScoredPost {
  uri: string;
  authorDid: string;
  score: WeightedScore;
}

// ────────────────────────────────────────────────────────────────────────────
// Governance shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * Identifier for a governance-voted scoring weight.
 *
 * Was a 5-value literal union before PROJ-816; widened to `string` so the
 * type contract no longer fossilizes a fixed component count. Runtime
 * validity is enforced by the server's REGISTERED_COMPONENT_KEYS set.
 */
export type GovernanceWeightKey = string;

/** Weight vector for the scoring algorithm. Values 0.0–1.0; sum to 1.0. */
export type GovernanceWeights = Record<GovernanceWeightKey, number>;

/**
 * Configuration for a votable weight parameter — the public-facing shape used
 * by the voting UI and exposed by the governance API.
 */
export interface VotableWeightParam {
  key: GovernanceWeightKey;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
}

/**
 * Governance epoch — the snapshot of community-voted weights and topic
 * preferences in effect for a scoring run.
 */
export interface GovernanceEpoch {
  id: number;
  status: 'active' | 'voting' | 'closed';
  weights: GovernanceWeights;
  voteCount: number;
  createdAt: Date;
  closedAt: Date | null;
  description: string | null;
  /** Community-voted topic weights. Slug → weight (0.0-1.0). */
  topicWeights?: Record<string, number>;
}

// ────────────────────────────────────────────────────────────────────────────
// Post shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * Post data as fetched for scoring. The shape mirrors what the production
 * pipeline assembles from `posts` + `post_engagement`. Component authors who
 * need additional fields (e.g. post images) should propose extending this
 * interface via a Linear packet against `bluesky-community-feed`.
 */
export interface PostForScoring {
  uri: string;
  cid: string;
  authorDid: string;
  text: string | null;
  replyRoot: string | null;
  replyParent: string | null;
  langs: string[];
  hasMedia: boolean;
  createdAt: Date;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  /** Topic classification vector from ingestion. Slug → confidence (0.0–1.0). */
  topicVector?: Record<string, number>;
  /** Which classifier produced the topic_vector. */
  classificationMethod?: 'keyword' | 'embedding';
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a `ScoringComponent` from a synchronous or asynchronous score fn.
 *
 * Saves boilerplate for the common case — most components are a pure
 * `(post, context) => number` and don't benefit from the manual interface
 * implementation.
 *
 * @example
 * ```ts
 * import { createComponent } from '@corgi/feed-sdk';
 *
 * export const civilityComponent = createComponent({
 *   key: 'civility',
 *   name: 'Civility',
 *   score(post) {
 *     return classifyCivility(post.text ?? '');
 *   },
 * });
 * ```
 */
export function createComponent(spec: {
  key: string;
  name: string;
  score: (
    post: PostForScoring,
    context: ScoringContext
  ) => number | Promise<number>;
}): ScoringComponent {
  return {
    key: spec.key,
    name: spec.name,
    async score(post, context) {
      const result = await scoreWithDiagnostics(
        spec.key,
        spec.score,
        post,
        context
      );
      if (!Number.isFinite(result) || result < 0 || result > 1) {
        throw new RangeError(
          `Scoring component "${spec.key}" returned out-of-range score ${result}; expected 0.0 to 1.0`
        );
      }
      return result;
    },
  };
}

class ScoringComponentScoreError extends Error {
  constructor(componentKey: string, sourceError: unknown) {
    super(
      `Scoring component "${componentKey}" failed: ${messageFromError(sourceError)}`
    );
    this.name = 'ScoringComponentScoreError';
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return String(error);
}

async function scoreWithDiagnostics(
  componentKey: string,
  score: (
    post: PostForScoring,
    context: ScoringContext
  ) => number | Promise<number>,
  post: PostForScoring,
  context: ScoringContext
): Promise<number> {
  try {
    return await score(post, context);
  } catch (error) {
    throw new ScoringComponentScoreError(componentKey, error);
  }
}

/**
 * Compute the snake_case wide-column name for a given component key.
 *
 * Mirrors the server-side helper. Useful for tests that exercise vote
 * submission. Deprecated after PROJ-819 (P5) drops the wide columns; until
 * then it's a stable mapping for backfill scripts and integration tests.
 */
export function voteFieldForKey(key: GovernanceWeightKey): string {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `${snake}_weight`;
}

/**
 * Transparency Types
 *
 * Type definitions for the transparency and explainability layer.
 */

/**
 * Score component with raw value, weight, and weighted contribution.
 */
export interface ScoreComponent {
  raw_score: number;
  weight: number;
  weighted: number;
}

/**
 * Per-topic breakdown entry for the relevance component.
 * Shows how each topic in a post's topic vector contributed to its relevance score.
 */
export interface TopicBreakdownEntry {
  /** The post's classifier confidence for this topic (0.0–1.0). */
  postScore: number;
  /** The community-voted weight for this topic (0.0–1.0, default 0.5). */
  communityWeight: number;
  /** postScore × communityWeight — this topic's contribution to the weighted sum. */
  contribution: number;
}

/**
 * Full explanation of why a post is ranked where it is.
 */
export interface PostExplanation {
  post_uri: string;
  epoch_id: number;
  epoch_description: string | null;
  total_score: number;
  rank: number;
  components: {
    recency: ScoreComponent;
    engagement: ScoreComponent;
    bridging: ScoreComponent;
    source_diversity: ScoreComponent;
    relevance: ScoreComponent & {
      /** Per-topic breakdown when topic data is available. */
      topicBreakdown?: Record<string, TopicBreakdownEntry>;
    };
  };
  governance_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  counterfactual: {
    pure_engagement_rank: number;
    community_governed_rank: number;
    difference: number;
  };
  scored_at: Date;
  component_details: Record<string, unknown> | null;
  /** Whether this score used "keyword" (winkNLP) or "embedding" (Tier 2 semantic) classification. */
  classification_method?: 'keyword' | 'embedding';
}

/**
 * Aggregate statistics for the current feed.
 */
export interface FeedStats {
  epoch: {
    id: number;
    status: string;
    weights: {
      recency: number;
      engagement: number;
      bridging: number;
      source_diversity: number;
      relevance: number;
    };
    created_at: Date;
  };
  feed_stats: {
    total_posts_scored: number;
    unique_authors: number;
    avg_bridging_score: number;
    avg_engagement_score: number;
    median_bridging_score: number;
    median_total_score: number;
  };
  governance: {
    votes_this_epoch: number;
  };
  metrics?: {
    author_gini: number | null;
    vs_chronological_overlap: number | null;
    vs_engagement_overlap: number | null;
  };
}

/**
 * Pre-computed metrics for an epoch.
 */
export interface EpochMetrics {
  id: number;
  epoch_id: number;
  author_gini: number | null;
  avg_bridging: number | null;
  median_bridging: number | null;
  vs_chronological_overlap: number | null;
  vs_engagement_overlap: number | null;
  posts_scored: number;
  unique_authors: number;
  computed_at: Date;
}

/**
 * Result of a counterfactual analysis (what-if with different weights).
 */
export interface CounterfactualPost {
  post_uri: string;
  original_score: number;
  original_rank: number;
  counterfactual_score: number;
  counterfactual_rank: number;
  rank_delta: number;
}

export interface CounterfactualResult {
  alternate_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  current_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  posts: CounterfactualPost[];
  summary: {
    total_posts: number;
    posts_moved_up: number;
    posts_moved_down: number;
    posts_unchanged: number;
    max_rank_change: number;
    avg_rank_change: number;
  };
}

/**
 * Entry in the governance audit log.
 */
export interface AuditLogEntry {
  id: number;
  action: string;
  // Public transparency responses redact actor identity.
  actor_did: string | null;
  epoch_id: number | null;
  details: Record<string, unknown>;
  created_at: Date;
}

/**
 * Paginated audit log response.
 */
export interface AuditLogResponse {
  entries: AuditLogEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/**
 * Score Types
 *
 * Type definitions for the scoring pipeline.
 * These types enforce the GOLDEN RULE: always store raw, weight, AND weighted values.
 */

/**
 * The five scoring components.
 * Each value should be normalized to 0.0-1.0 range.
 */
export interface ScoreComponents {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

/**
 * Complete score decomposition for a post.
 * This is what gets stored in the database - all the data needed for transparency.
 */
export interface WeightedScore {
  /** Raw component scores (0.0-1.0) */
  raw: ScoreComponents;
  /** Weights from governance epoch (must sum to 1.0) */
  weights: ScoreComponents;
  /** Weighted values (raw × weight) */
  weighted: ScoreComponents;
  /** Final combined score (sum of weighted values) */
  total: number;
}

/**
 * A post with its computed score.
 * Used during pipeline processing.
 */
export interface ScoredPost {
  uri: string;
  authorDid: string;
  score: WeightedScore;
}

/**
 * Governance epoch with weights.
 * Represents the current algorithm configuration.
 */
export interface GovernanceEpoch {
  id: number;
  status: 'active' | 'voting' | 'closed';
  recencyWeight: number;
  engagementWeight: number;
  bridgingWeight: number;
  sourceDiversityWeight: number;
  relevanceWeight: number;
  voteCount: number;
  createdAt: Date;
  closedAt: Date | null;
  description: string | null;
  /** Community-voted topic weights from governance. Slug → weight (0.0-1.0). */
  topicWeights?: Record<string, number>;
}

/**
 * Post data from database with engagement counts.
 * This is what gets fetched for scoring.
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
  /** Topic classification vector from ingestion. Slug → confidence (0.0-1.0). */
  topicVector?: Record<string, number>;
  /** Which classifier produced the topic_vector: winkNLP keywords or Transformers.js embeddings. */
  classificationMethod?: 'keyword' | 'embedding';
}

/**
 * Convert snake_case DB row to camelCase GovernanceEpoch.
 */
export function toGovernanceEpoch(row: Record<string, unknown>): GovernanceEpoch {
  return {
    id: row.id as number,
    status: row.status as 'active' | 'voting' | 'closed',
    recencyWeight: row.recency_weight as number,
    engagementWeight: row.engagement_weight as number,
    bridgingWeight: row.bridging_weight as number,
    sourceDiversityWeight: row.source_diversity_weight as number,
    relevanceWeight: row.relevance_weight as number,
    voteCount: row.vote_count as number,
    createdAt: new Date(row.created_at as string),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
    description: row.description as string | null,
    topicWeights: (row.topic_weights as Record<string, number>) ?? {},
  };
}

/**
 * Convert snake_case DB row to camelCase PostForScoring.
 */
export function toPostForScoring(row: Record<string, unknown>): PostForScoring {
  return {
    uri: row.uri as string,
    cid: row.cid as string,
    authorDid: row.author_did as string,
    text: row.text as string | null,
    replyRoot: row.reply_root as string | null,
    replyParent: row.reply_parent as string | null,
    langs: (row.langs as string[]) ?? [],
    hasMedia: row.has_media as boolean,
    createdAt: new Date(row.created_at as string),
    likeCount: (row.like_count as number) ?? 0,
    repostCount: (row.repost_count as number) ?? 0,
    replyCount: (row.reply_count as number) ?? 0,
    topicVector: (row.topic_vector as Record<string, number>) ?? {},
    classificationMethod: (row.classification_method as string) === 'embedding' ? 'embedding' : 'keyword',
  };
}

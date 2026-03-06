/**
 * Shared Export Types
 *
 * Type-only interfaces for research data export.
 * Used by export API routes and CLI direct mode.
 */

/** Anonymized vote record for research export. */
export interface ExportVoteRecord {
  anon_voter_id: string;
  epoch_id: number;
  recency_weight: number | null;
  engagement_weight: number | null;
  bridging_weight: number | null;
  source_diversity_weight: number | null;
  relevance_weight: number | null;
  include_keywords: string[];
  exclude_keywords: string[];
  voted_at: string;
}

/** Score record for research export (all 15 columns per Golden Rule). */
export interface ExportScoreRecord {
  post_uri: string;
  epoch_id: number;
  recency_score: number;
  engagement_score: number;
  bridging_score: number;
  source_diversity_score: number;
  relevance_score: number;
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
  recency_weighted: number;
  engagement_weighted: number;
  bridging_weighted: number;
  source_diversity_weighted: number;
  relevance_weighted: number;
  total_score: number;
  scored_at: string;
}

/** Engagement attribution record for research export. */
export interface ExportEngagementRecord {
  post_uri: string;
  anon_viewer_id: string;
  epoch_id: number;
  engagement_type: string | null;
  position_in_feed: number | null;
  served_at: string;
  engaged_at: string | null;
}

/** Epoch metadata for research export. */
export interface ExportEpochRecord {
  id: number;
  status: string;
  phase: string | null;
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
  vote_count: number;
  content_rules: Record<string, unknown> | null;
  created_at: string;
  closed_at: string | null;
  voting_started_at: string | null;
  voting_closed_at: string | null;
}

/** Audit log entry for research export. */
export interface ExportAuditRecord {
  id: number;
  action: string;
  anon_actor_id: string | null;
  epoch_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

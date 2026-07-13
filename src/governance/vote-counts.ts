import type { PoolClient } from 'pg';

export interface GovernanceVoteCounts {
  total: number;
  content: number;
  topic: number;
}

export async function readGovernanceVoteCounts(
  client: PoolClient,
  epochId: number
): Promise<GovernanceVoteCounts> {
  const result = await client.query<{ total: string; content: string; topic: string }>(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE
          (include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0)
          OR
          (exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0)
      )::int AS content,
      COUNT(*) FILTER (
        WHERE topic_weight_votes IS NOT NULL
          AND topic_weight_votes != '{}'::jsonb
      )::int AS topic
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  return {
    total: Number.parseInt(result.rows[0]?.total ?? '0', 10),
    content: Number.parseInt(result.rows[0]?.content ?? '0', 10),
    topic: Number.parseInt(result.rows[0]?.topic ?? '0', 10),
  };
}

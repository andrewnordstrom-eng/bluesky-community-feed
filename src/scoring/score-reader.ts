/**
 * Score reader — uniform interface over wide-column and long-table backends.
 *
 * The transparency, admin, and governance routes all need decomposed score
 * data (raw, weight, weighted, per component). Pre-refactor they SELECTed the
 * 15 named wide columns directly from `post_scores`. PROJ-817 (P4) is the
 * reader migration; this module is the seam.
 *
 * Behind `SCORE_LONGTABLE_READ_ENABLED`:
 *   - false (default through bake-in): read the 15 wide columns from
 *     `post_scores`. Existing behavior, unchanged.
 *   - true (default after PROJ-817 flag flip): read from the normalized
 *     `post_score_components` long table and pivot in-memory.
 *
 * Both paths return the same shape (`PostScoreRecord`) so callers do not
 * branch on the storage backend.
 *
 * Cutover is PROJ-819 (P5) — at that point the wide columns and the
 * `widePath` branch here disappear; only the long-table read remains.
 */

import { db } from '../db/client.js';
import { config } from '../config.js';

/**
 * Per-component score triple — what gets stored, returned, and rendered.
 * Keys are component identifiers from the registry (e.g. `recency`,
 * `engagement`, `bridging`, `sourceDiversity`, `relevance`, or any future key).
 */
export interface ComponentScoreTriple {
  raw: number;
  weight: number;
  weighted: number;
}

/**
 * Normalized post-score record. Same shape regardless of which storage
 * backend produced it.
 */
export interface PostScoreRecord {
  postUri: string;
  epochId: number;
  totalScore: number;
  scoredAt: Date;
  classificationMethod: 'keyword' | 'embedding';
  /** component_details JSONB column from post_scores (preserved through cutover). */
  componentDetails: Record<string, unknown> | null;
  /** Per-component decomposition. Key set matches the registered components at scoring time. */
  components: Record<string, ComponentScoreTriple>;
}

const WIDE_COMPONENT_COLUMNS = [
  ['recency', 'recency_score', 'recency_weight', 'recency_weighted'],
  ['engagement', 'engagement_score', 'engagement_weight', 'engagement_weighted'],
  ['bridging', 'bridging_score', 'bridging_weight', 'bridging_weighted'],
  ['sourceDiversity', 'source_diversity_score', 'source_diversity_weight', 'source_diversity_weighted'],
  ['relevance', 'relevance_score', 'relevance_weight', 'relevance_weighted'],
] as const;

const COMPONENT_KEY_TO_WIDE_PREFIX: Record<string, string> = {
  recency: 'recency',
  engagement: 'engagement',
  bridging: 'bridging',
  sourceDiversity: 'source_diversity',
  relevance: 'relevance',
};

/** Options for fetching a single post's score. */
export interface ReadPostScoreOptions {
  /** AT-URI of the post. */
  postUri: string;
  /** Governance epoch to read from. */
  epochId: number;
  /**
   * Restrict to a specific scoring run (component_details->>'run_id').
   * Used by post-explain to avoid mixing scores from different incremental runs.
   */
  runId?: string;
}

/**
 * Read the decomposed score for a single post in a specific epoch.
 *
 * Returns `null` if no score exists for the given post + epoch (+ run filter).
 */
export async function readPostScore(
  options: ReadPostScoreOptions
): Promise<PostScoreRecord | null> {
  if (config.SCORE_LONGTABLE_READ_ENABLED) {
    return readPostScoreFromLongTable(options);
  }
  return readPostScoreFromWideColumns(options);
}

async function readPostScoreFromWideColumns({
  postUri,
  epochId,
  runId,
}: ReadPostScoreOptions): Promise<PostScoreRecord | null> {
  const params: unknown[] = [postUri, epochId];
  let runClause = '';
  if (runId) {
    params.push(runId);
    runClause = `AND component_details->>'run_id' = $${params.length}`;
  }

  const result = await db.query<Record<string, unknown>>(
    `SELECT post_uri, epoch_id, total_score, scored_at, classification_method, component_details,
            recency_score, engagement_score, bridging_score, source_diversity_score, relevance_score,
            recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight,
            recency_weighted, engagement_weighted, bridging_weighted, source_diversity_weighted, relevance_weighted
     FROM post_scores
     WHERE post_uri = $1 AND epoch_id = $2 ${runClause}
     ORDER BY scored_at DESC
     LIMIT 1`,
    params
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const components: Record<string, ComponentScoreTriple> = {};
  for (const [key, rawCol, weightCol, weightedCol] of WIDE_COMPONENT_COLUMNS) {
    components[key] = {
      raw: parseFloat(String(row[rawCol] ?? 0)),
      weight: parseFloat(String(row[weightCol] ?? 0)),
      weighted: parseFloat(String(row[weightedCol] ?? 0)),
    };
  }

  return {
    postUri: String(row.post_uri),
    epochId: Number(row.epoch_id),
    totalScore: parseFloat(String(row.total_score)),
    scoredAt: new Date(String(row.scored_at)),
    classificationMethod:
      (row.classification_method as 'keyword' | 'embedding') ?? 'keyword',
    componentDetails:
      row.component_details && typeof row.component_details === 'object'
        ? (row.component_details as Record<string, unknown>)
        : null,
    components,
  };
}

async function readPostScoreFromLongTable({
  postUri,
  epochId,
  runId,
}: ReadPostScoreOptions): Promise<PostScoreRecord | null> {
  // First read the post-level row (carries total_score, scored_at, etc.) —
  // these scalars stay denormalized on post_scores even after P5 contract.
  const params: unknown[] = [postUri, epochId];
  let runClause = '';
  if (runId) {
    params.push(runId);
    runClause = `AND ps.component_details->>'run_id' = $${params.length}`;
  }

  const psResult = await db.query<{
    post_uri: string;
    epoch_id: number;
    total_score: string;
    scored_at: string;
    classification_method: string | null;
    component_details: Record<string, unknown> | null;
  }>(
    `SELECT ps.post_uri, ps.epoch_id, ps.total_score, ps.scored_at,
            ps.classification_method, ps.component_details
     FROM post_scores ps
     WHERE ps.post_uri = $1 AND ps.epoch_id = $2 ${runClause}
     ORDER BY ps.scored_at DESC
     LIMIT 1`,
    params
  );

  const psRow = psResult.rows[0];
  if (!psRow) {
    return null;
  }

  const compResult = await db.query<{
    component_key: string;
    raw: string;
    weight: string;
    weighted: string;
  }>(
    `SELECT psc.component_key, psc.raw, psc.weight, psc.weighted
     FROM post_score_components psc
     JOIN post_scores ps ON ps.post_uri = psc.post_uri AND ps.epoch_id = psc.epoch_id
     WHERE psc.post_uri = $1 AND psc.epoch_id = $2 ${runClause}`,
    params
  );

  const components: Record<string, ComponentScoreTriple> = {};
  for (const row of compResult.rows) {
    components[row.component_key] = {
      raw: parseFloat(row.raw),
      weight: parseFloat(row.weight),
      weighted: parseFloat(row.weighted),
    };
  }

  return {
    postUri: psRow.post_uri,
    epochId: psRow.epoch_id,
    totalScore: parseFloat(psRow.total_score),
    scoredAt: new Date(psRow.scored_at),
    classificationMethod:
      (psRow.classification_method as 'keyword' | 'embedding') ?? 'keyword',
    componentDetails: psRow.component_details,
    components,
  };
}

/**
 * Per-post score row for batch reads — what the counterfactual route and
 * feed-stats consume. Includes only the fields they need; lighter than the
 * full PostScoreRecord (no scoredAt, no componentDetails).
 */
export interface BatchPostScoreRow {
  postUri: string;
  totalScore: number;
  components: Record<string, ComponentScoreTriple>;
}

/**
 * Read top-N posts for an epoch with their per-component decomposition.
 *
 * Returns rows sorted by total_score DESC. Used by counterfactual (which
 * recomputes scores with alternate weights) and other batch consumers.
 *
 * Behind SCORE_LONGTABLE_READ_ENABLED:
 *   - false: SELECT all 15 wide columns + total_score from post_scores.
 *   - true: SELECT total_score from post_scores joined with
 *     post_score_components, pivoted via jsonb_object_agg per row.
 *
 * Either path returns the same uniform shape.
 */
export async function readPostScoresForEpoch(options: {
  epochId: number;
  limit: number;
  runId?: string;
}): Promise<BatchPostScoreRow[]> {
  const { epochId, limit, runId } = options;

  if (config.SCORE_LONGTABLE_READ_ENABLED) {
    const params: unknown[] = [epochId];
    let runClause = '';
    if (runId) {
      params.push(runId);
      runClause = `AND ps.component_details->>'run_id' = $${params.length}`;
    }
    params.push(limit);

    const result = await db.query<{
      post_uri: string;
      total_score: string;
      components_raw: Record<string, string> | null;
      components_weight: Record<string, string> | null;
      components_weighted: Record<string, string> | null;
    }>(
      `SELECT
         ps.post_uri,
         ps.total_score,
         jsonb_object_agg(psc.component_key, psc.raw) FILTER (WHERE psc.component_key IS NOT NULL) AS components_raw,
         jsonb_object_agg(psc.component_key, psc.weight) FILTER (WHERE psc.component_key IS NOT NULL) AS components_weight,
         jsonb_object_agg(psc.component_key, psc.weighted) FILTER (WHERE psc.component_key IS NOT NULL) AS components_weighted
       FROM post_scores ps
       LEFT JOIN post_score_components psc
         ON psc.post_uri = ps.post_uri AND psc.epoch_id = ps.epoch_id
       WHERE ps.epoch_id = $1 ${runClause}
       GROUP BY ps.post_uri, ps.total_score
       ORDER BY ps.total_score DESC
       LIMIT $${params.length}`,
      params
    );

    return result.rows.map((row) => {
      const components: Record<string, ComponentScoreTriple> = {};
      const rawMap = row.components_raw ?? {};
      const weightMap = row.components_weight ?? {};
      const weightedMap = row.components_weighted ?? {};
      for (const key of Object.keys(rawMap)) {
        components[key] = {
          raw: parseFloat(String(rawMap[key] ?? 0)),
          weight: parseFloat(String(weightMap[key] ?? 0)),
          weighted: parseFloat(String(weightedMap[key] ?? 0)),
        };
      }
      return {
        postUri: row.post_uri,
        totalScore: parseFloat(row.total_score),
        components,
      };
    });
  }

  const params: unknown[] = [epochId];
  let runClause = '';
  if (runId) {
    params.push(runId);
    runClause = `AND component_details->>'run_id' = $${params.length}`;
  }
  params.push(limit);

  const result = await db.query<Record<string, unknown>>(
    `SELECT post_uri, total_score,
            recency_score, engagement_score, bridging_score, source_diversity_score, relevance_score,
            recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight,
            recency_weighted, engagement_weighted, bridging_weighted, source_diversity_weighted, relevance_weighted
     FROM post_scores
     WHERE epoch_id = $1 ${runClause}
     ORDER BY total_score DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => {
    const components: Record<string, ComponentScoreTriple> = {};
    for (const [key, rawCol, weightCol, weightedCol] of WIDE_COMPONENT_COLUMNS) {
      components[key] = {
        raw: parseFloat(String(row[rawCol] ?? 0)),
        weight: parseFloat(String(row[weightCol] ?? 0)),
        weighted: parseFloat(String(row[weightedCol] ?? 0)),
      };
    }
    return {
      postUri: String(row.post_uri),
      totalScore: parseFloat(String(row.total_score)),
      components,
    };
  });
}

/**
 * Per-component aggregates for an epoch.
 */
export interface EpochComponentStats {
  avg: number;
  median: number;
  count: number;
}

/**
 * Aggregate (avg + median + count) of a single component's raw score across
 * an epoch. Returns `null` if no rows match (no posts scored, or no
 * registered component matched the key).
 *
 * Used by feed-stats (avg/median for bridging, avg for engagement) and other
 * transparency surfaces that summarize per-component distributions.
 */
export async function readEpochComponentStats(options: {
  epochId: number;
  componentKey: string;
  runId?: string;
}): Promise<EpochComponentStats | null> {
  const { epochId, componentKey, runId } = options;

  if (config.SCORE_LONGTABLE_READ_ENABLED) {
    const params: unknown[] = [epochId, componentKey];
    if (runId) {
      params.push(runId);
      const result = await db.query<{
        avg: string | null;
        median: string | null;
        count: string;
      }>(
        `SELECT
           AVG(psc.raw)::text as avg,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY psc.raw)::text as median,
           COUNT(*)::text as count
         FROM post_scores ps
         JOIN post_score_components psc
           ON psc.post_uri = ps.post_uri AND psc.epoch_id = ps.epoch_id
         WHERE ps.epoch_id = $1
           AND psc.component_key = $2
           AND ps.component_details->>'run_id' = $${params.length}`,
        params
      );
      const row = result.rows[0];
      const count = parseInt(row?.count ?? '0', 10);
      if (count === 0 || row?.avg === null || row?.median === null) {
        return null;
      }
      return {
        avg: parseFloat(row.avg),
        median: parseFloat(row.median),
        count,
      };
    }

    const result = await db.query<{
      avg: string | null;
      median: string | null;
      count: string;
    }>(
      `SELECT
         AVG(psc.raw)::text as avg,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY psc.raw)::text as median,
         COUNT(*)::text as count
       FROM post_score_components psc
       WHERE psc.epoch_id = $1 AND psc.component_key = $2
      `,
      params
    );
    const row = result.rows[0];
    const count = parseInt(row?.count ?? '0', 10);
    if (count === 0 || row?.avg === null || row?.median === null) {
      return null;
    }
    return {
      avg: parseFloat(row.avg),
      median: parseFloat(row.median),
      count,
    };
  }

  // Wide path — map camelCase key to snake_case column.
  const prefix = COMPONENT_KEY_TO_WIDE_PREFIX[componentKey];
  if (!prefix) {
    return null;
  }
  const column = `${prefix}_score`;
  const params: unknown[] = [epochId];
  let runClause = '';
  if (runId) {
    params.push(runId);
    runClause = `AND component_details->>'run_id' = $${params.length}`;
  }
  const result = await db.query<{
    avg: string | null;
    median: string | null;
    count: string;
  }>(
    `SELECT
       AVG(${column})::text as avg,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${column})::text as median,
       COUNT(*)::text as count
     FROM post_scores
     WHERE epoch_id = $1
       ${runClause}`,
    params
  );
  const row = result.rows[0];
  const count = parseInt(row?.count ?? '0', 10);
  if (count === 0 || row?.avg === null || row?.median === null) {
    return null;
  }
  return {
    avg: parseFloat(row.avg),
    median: parseFloat(row.median),
    count,
  };
}

/**
 * Count posts in an epoch whose value for a single component exceeds a
 * threshold. Used by counterfactual ranking (e.g. "how many posts have a
 * higher engagement score than this one").
 *
 * `componentKey` is the camelCase key as in the registry (`recency`,
 * `engagement`, etc.). Returns the count.
 */
export async function countPostsWithComponentAbove(options: {
  epochId: number;
  componentKey: string;
  threshold: number;
  runId?: string;
}): Promise<number> {
  const { epochId, componentKey, threshold, runId } = options;

  if (config.SCORE_LONGTABLE_READ_ENABLED) {
    const params: unknown[] = [epochId, componentKey, threshold];
    let runClause = '';
    if (runId) {
      params.push(runId);
      runClause = `AND ps.component_details->>'run_id' = $${params.length}`;
    }
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM post_score_components psc
       JOIN post_scores ps ON ps.post_uri = psc.post_uri AND ps.epoch_id = psc.epoch_id
       WHERE psc.epoch_id = $1
         AND psc.component_key = $2
         AND psc.raw > $3
         ${runClause}`,
      params
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  // Wide-column path: map camelCase component key to snake_case column.
  const prefix = COMPONENT_KEY_TO_WIDE_PREFIX[componentKey];
  if (!prefix) {
    throw new Error(
      `countPostsWithComponentAbove: unknown component key "${componentKey}" — not mapped to a wide-column name. ` +
        `This usually means a component was registered after PROJ-817 (P4) flag flipped but a caller still uses the wide path.`
    );
  }
  const column = `${prefix}_score`;
  const params: unknown[] = [epochId, threshold];
  let runClause = '';
  if (runId) {
    params.push(runId);
    runClause = `AND component_details->>'run_id' = $${params.length}`;
  }
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM post_scores
     WHERE epoch_id = $1
       AND ${column} > $2
       ${runClause}`,
    params
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

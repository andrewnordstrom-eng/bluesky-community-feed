/**
 * Governance Weight Long-Table Dual-Write Helpers (PROJ-815 / P2)
 *
 * Mirror the 5 wide weight columns on governance_epochs and governance_votes
 * into the normalized side tables governance_epoch_weights and
 * governance_vote_weights (migration 022). One row per registered weight key.
 *
 * Wide columns remain authoritative through PROJ-817 (P4). PROJ-819 (P5)
 * drops the wide columns and the helpers in this file become the sole write
 * path (the dual-write conditional is removed).
 *
 * IMPORTANT: callers must already have done the wide-column INSERT and have
 * the corresponding epoch_id or vote_id before invoking these helpers. The
 * config flag check is the caller's responsibility — these helpers always
 * write when called.
 */

import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { db } from '../db/client.js';
import type { GovernanceWeightKey } from '../shared/api-types.js';

/**
 * Read the registered weight vector for N governance epochs in a single
 * query, returning Record<epochId, Record<componentKey, weight>>. Used by
 * admin/epochs.ts which lists 20 epochs at a time and would otherwise
 * incur 20 readEpochWeights round-trips.
 *
 * Behind GOVERNANCE_LONGTABLE_READ_ENABLED:
 *   - false: SELECT id, recency_weight, ... FROM governance_epochs WHERE id IN (...)
 *   - true: SELECT epoch_id, component_key, weight FROM governance_epoch_weights WHERE epoch_id IN (...)
 *
 * Epochs in the input list that have no rows return an empty {} for their
 * weights (the caller can detect "no weights yet" by `Object.keys(...).length === 0`).
 */
export async function readEpochWeightsForMultipleEpochs(options: {
  epochIds: number[];
}): Promise<Record<number, Record<GovernanceWeightKey, number>>> {
  const { epochIds } = options;
  if (epochIds.length === 0) {
    return {};
  }

  const out: Record<number, Record<string, number>> = {};
  for (const id of epochIds) {
    out[id] = {};
  }

  if (config.GOVERNANCE_LONGTABLE_READ_ENABLED) {
    const result = await db.query<{
      epoch_id: number;
      component_key: string;
      weight: string;
    }>(
      `SELECT epoch_id, component_key, weight
       FROM governance_epoch_weights
       WHERE epoch_id = ANY($1::int[])`,
      [epochIds]
    );
    for (const row of result.rows) {
      out[row.epoch_id][row.component_key] = parseFloat(row.weight);
    }
    return out;
  }

  const result = await db.query<{
    id: number;
    recency_weight: string;
    engagement_weight: string;
    bridging_weight: string;
    source_diversity_weight: string;
    relevance_weight: string;
  }>(
    `SELECT id, recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_epochs
     WHERE id = ANY($1::int[])`,
    [epochIds]
  );
  for (const row of result.rows) {
    out[row.id] = {
      recency: parseFloat(row.recency_weight),
      engagement: parseFloat(row.engagement_weight),
      bridging: parseFloat(row.bridging_weight),
      sourceDiversity: parseFloat(row.source_diversity_weight),
      relevance: parseFloat(row.relevance_weight),
    };
  }
  return out;
}

/**
 * Read the registered weight vector for a governance epoch. Returns
 * keys in the registry's camelCase form (recency, engagement, bridging,
 * sourceDiversity, relevance, plus any future components).
 *
 * Behind GOVERNANCE_LONGTABLE_READ_ENABLED:
 *   - false (default through P4 bake-in): SELECT the 5 wide columns from
 *     governance_epochs and project them.
 *   - true (default after PROJ-817 flag flip): SELECT from
 *     governance_epoch_weights long table and pivot.
 *
 * Returns null if no epoch row exists. Returns an empty object if the epoch
 * row exists but no weight rows have been written yet (early in transition).
 */
export async function readEpochWeights(options: {
  epochId: number;
}): Promise<Record<GovernanceWeightKey, number> | null> {
  const { epochId } = options;

  if (config.GOVERNANCE_LONGTABLE_READ_ENABLED) {
    const existsResult = await db.query<{ id: number }>(
      `SELECT id FROM governance_epochs WHERE id = $1`,
      [epochId]
    );
    if (existsResult.rows.length === 0) {
      return null;
    }
    const weightsResult = await db.query<{ component_key: string; weight: string }>(
      `SELECT component_key, weight FROM governance_epoch_weights WHERE epoch_id = $1`,
      [epochId]
    );
    const out: Record<string, number> = {};
    for (const row of weightsResult.rows) {
      out[row.component_key] = parseFloat(row.weight);
    }
    return out;
  }

  const result = await db.query<{
    recency_weight: string;
    engagement_weight: string;
    bridging_weight: string;
    source_diversity_weight: string;
    relevance_weight: string;
  }>(
    `SELECT recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_epochs
     WHERE id = $1`,
    [epochId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    recency: parseFloat(row.recency_weight),
    engagement: parseFloat(row.engagement_weight),
    bridging: parseFloat(row.bridging_weight),
    sourceDiversity: parseFloat(row.source_diversity_weight),
    relevance: parseFloat(row.relevance_weight),
  };
}

/**
 * Build the (placeholders, params) tuple for a batched VALUES clause of N
 * (id, component_key, weight) triples. Each row contributes 3 placeholders
 * and 3 params. Used by both helpers below.
 */
function buildWeightRows(
  id: number | string,
  weights: Record<GovernanceWeightKey, number>
): { placeholders: string; params: unknown[] } {
  const entries = Object.entries(weights);
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [key, weight] of entries) {
    const offset = params.length;
    params.push(id, key, weight);
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3})`
    );
  }
  return { placeholders: placeholders.join(', '), params };
}

/**
 * Write N rows into governance_epoch_weights — one per registered weight key.
 * Idempotent via ON CONFLICT DO UPDATE so a re-emitted transition does not
 * conflict. Pass the transactional `client` so this runs inside the same
 * transaction as the wide-row INSERT in epoch-manager.ts.
 */
export async function writeEpochWeights(
  client: PoolClient,
  epochId: number,
  weights: Record<GovernanceWeightKey, number>
): Promise<void> {
  if (Object.keys(weights).length === 0) {
    return;
  }
  const { placeholders, params } = buildWeightRows(epochId, weights);
  await client.query(
    `INSERT INTO governance_epoch_weights (epoch_id, component_key, weight)
     VALUES ${placeholders}
     ON CONFLICT (epoch_id, component_key) DO UPDATE SET weight = EXCLUDED.weight`,
    params
  );
}

/**
 * Write N rows into governance_vote_weights — one per submitted weight key.
 * Mirrors COALESCE semantics from the wide-row UPSERT: keys with null/undefined
 * values are skipped (preserves prior long-table rows on a partial update).
 *
 * Uses the autocommit pool `db` since the caller in routes/vote.ts is not
 * already inside a transaction. A failure here does not roll back the wide
 * row — the same eventual-consistency contract that PROJ-814 (P1) established
 * for scoring decomposition. Backfill converges any gap.
 */
export async function writeVoteWeights(
  voteId: string,
  weights: Partial<Record<GovernanceWeightKey, number | null | undefined>>
): Promise<void> {
  const nonNull = Object.entries(weights).filter(
    ([, weight]) => typeof weight === 'number' && Number.isFinite(weight)
  ) as Array<[GovernanceWeightKey, number]>;

  if (nonNull.length === 0) {
    return;
  }

  const fullWeights = Object.fromEntries(nonNull) as Record<GovernanceWeightKey, number>;
  const { placeholders, params } = buildWeightRows(voteId, fullWeights);

  await db.query(
    `INSERT INTO governance_vote_weights (vote_id, component_key, weight)
     VALUES ${placeholders}
     ON CONFLICT (vote_id, component_key) DO UPDATE SET weight = EXCLUDED.weight`,
    params
  );
}

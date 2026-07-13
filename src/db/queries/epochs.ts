/**
 * Governance epoch database queries.
 *
 * Extracted from pipeline.ts for reuse across modules.
 */

import { db } from '../client.js';
import type { GovernanceEpoch } from '../../scoring/score.types.js';
import { toGovernanceEpoch } from '../../scoring/score.types.js';
import { parseStoredTopicWeights } from '../../governance/topic-weights.js';

export interface ScoringGovernanceEpoch extends GovernanceEpoch {
  pendingRescoreGeneration: number | null;
}

function parsePendingRescoreGeneration(raw: unknown, epochId: number): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const generation = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error(
      `Invalid governance rescore generation for epoch ${epochId}: ${String(raw)}`
    );
  }

  return generation;
}

/**
 * Get the currently active governance epoch.
 * Returns null if no active epoch exists.
 */
export async function getActiveEpoch(): Promise<ScoringGovernanceEpoch | null> {
  const result = await db.query(
    `SELECT
       epoch.*,
       CASE
         WHEN rescore.requested_generation > rescore.completed_generation
           THEN rescore.requested_generation
         ELSE NULL
       END AS pending_rescore_generation
     FROM governance_epochs epoch
     LEFT JOIN governance_rescore_requests rescore ON rescore.epoch_id = epoch.id
     WHERE epoch.status = 'active'
     ORDER BY epoch.id DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const epoch = toGovernanceEpoch({
    ...row,
    topic_weights: parseStoredTopicWeights(
      row.topic_weights,
      `governance epoch ${String(row.id)} active scoring policy`
    ),
  });
  return {
    ...epoch,
    pendingRescoreGeneration: parsePendingRescoreGeneration(
      row.pending_rescore_generation,
      epoch.id
    ),
  };
}

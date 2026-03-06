/**
 * Governance epoch database queries.
 *
 * Extracted from pipeline.ts for reuse across modules.
 */

import { db } from '../client.js';
import type { GovernanceEpoch } from '../../scoring/score.types.js';
import { toGovernanceEpoch } from '../../scoring/score.types.js';

/**
 * Get the currently active governance epoch.
 * Returns null if no active epoch exists.
 */
export async function getActiveEpoch(): Promise<GovernanceEpoch | null> {
  const result = await db.query(
    `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toGovernanceEpoch(result.rows[0]);
}

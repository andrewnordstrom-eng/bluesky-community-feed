/**
 * Feed Access Control
 *
 * Manages approved participant checks for private feed mode.
 * Uses Redis cache with PostgreSQL fallback.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';

const CACHE_PREFIX = 'approved:did:';
const CACHE_TTL_SECONDS = 300;

/**
 * Check if a DID is an approved participant.
 * Uses Redis cache (TTL 300s) with PostgreSQL fallback.
 */
export async function isParticipantApproved(did: string): Promise<boolean> {
  // Try Redis cache first
  try {
    const cached = await redis.get(`${CACHE_PREFIX}${did}`);
    if (cached !== null) {
      return cached === '1';
    }
  } catch (err) {
    logger.warn({ err, did }, 'Failed to read participant cache from Redis');
  }

  // Fall back to PostgreSQL
  try {
    const result = await db.query(
      `SELECT 1 FROM approved_participants WHERE did = $1 AND removed_at IS NULL LIMIT 1`,
      [did]
    );
    const approved = result.rows.length > 0;

    // Cache the result
    try {
      await redis.setex(`${CACHE_PREFIX}${did}`, CACHE_TTL_SECONDS, approved ? '1' : '0');
    } catch (err) {
      logger.warn({ err, did }, 'Failed to cache participant status in Redis');
    }

    return approved;
  } catch (err) {
    logger.error({ err, did }, 'Failed to check participant approval in PostgreSQL');
    // Deny access on error in private mode
    return false;
  }
}

/**
 * Invalidate the participant cache for a DID.
 * Call after adding or removing a participant.
 */
export async function invalidateParticipantCache(did: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${did}`);
  } catch (err) {
    logger.warn({ err, did }, 'Failed to invalidate participant cache');
  }
}

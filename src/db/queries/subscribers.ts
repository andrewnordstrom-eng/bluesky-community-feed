/**
 * Subscriber database queries.
 *
 * Extracted from feed-skeleton.ts for reuse across modules.
 */

import { db } from '../client.js';
import { logger } from '../../lib/logger.js';

/**
 * Fire-and-forget subscriber UPSERT.
 * Inserts new subscribers or updates last_seen for existing ones.
 * Non-blocking — errors are logged but never propagated.
 */
export function upsertSubscriberAsync(did: string): void {
  setImmediate(() => {
    db.query(
      `INSERT INTO subscribers (did, first_seen, last_seen, is_active)
       VALUES ($1, NOW(), NOW(), TRUE)
       ON CONFLICT (did) DO UPDATE SET last_seen = NOW(), is_active = TRUE`,
      [did]
    ).catch((err) => logger.warn({ err, did }, 'Subscriber upsert failed'));
  });
}

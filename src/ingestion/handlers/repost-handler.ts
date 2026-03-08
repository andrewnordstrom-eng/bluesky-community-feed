/**
 * Repost Handler
 *
 * Handles reposts from Jetstream.
 * Stores the repost record and increments engagement counter.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface RepostRecord {
  subject?: {
    uri: string;
    cid?: string;
  };
  createdAt?: string;
}

export async function handleRepost(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<void> {
  const repostRecord = record as RepostRecord;

  const subjectUri = repostRecord.subject?.uri;
  if (!subjectUri) {
    logger.warn({ uri }, 'Repost missing subject URI');
    return;
  }

  const createdAt = repostRecord.createdAt ?? new Date().toISOString();

  try {
    // Insert repost only if the referenced post exists in our system.
    // This filters out the vast majority of firehose reposts (for posts we don't track).
    const result = await db.query(
      `INSERT INTO reposts (uri, author_did, subject_uri, created_at)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (SELECT 1 FROM posts WHERE uri = $3)
       ON CONFLICT (uri) DO NOTHING
       RETURNING uri`,
      [uri, authorDid, subjectUri, createdAt]
    );

    // Only increment counter if this was a new insert (not a duplicate)
    if (result.rowCount && result.rowCount > 0) {
      await db.query(
        `UPDATE post_engagement SET repost_count = repost_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [subjectUri]
      );

      // Fire-and-forget: mark engagement attribution if this user was served this post
      db.query(
        `WITH active_epoch AS (
           SELECT id
           FROM governance_epochs
           WHERE status = 'active'
           ORDER BY id DESC
           LIMIT 1
         )
         UPDATE engagement_attributions ea
         SET engaged_at = NOW(), engagement_type = 'repost'
         FROM active_epoch
         WHERE ea.post_uri = $1
           AND ea.viewer_did = $2
           AND ea.epoch_id = active_epoch.id
           AND ea.engaged_at IS NULL`,
        [subjectUri, authorDid]
      ).catch((err) => logger.warn({ err, subjectUri }, 'Attribution update failed'));
    }

    logger.debug({ uri, subjectUri }, 'Repost indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert repost');
    // Don't rethrow - log and continue processing other events
  }
}

/**
 * Like Handler
 *
 * Handles likes from Jetstream.
 * Stores the like record and increments engagement counter.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface LikeRecord {
  subject?: {
    uri: string;
    cid?: string;
  };
  createdAt?: string;
}

export async function handleLike(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<void> {
  const likeRecord = record as LikeRecord;

  const subjectUri = likeRecord.subject?.uri;
  if (!subjectUri) {
    logger.warn({ uri }, 'Like missing subject URI');
    return;
  }

  const createdAt = likeRecord.createdAt ?? new Date().toISOString();

  try {
    // Insert like only if the referenced post exists in our system.
    // This filters out the vast majority of firehose likes (for posts we don't track).
    const result = await db.query(
      `INSERT INTO likes (uri, author_did, subject_uri, created_at)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (SELECT 1 FROM posts WHERE uri = $3)
       ON CONFLICT (uri) DO NOTHING
       RETURNING uri`,
      [uri, authorDid, subjectUri, createdAt]
    );

    // Only increment counter if this was a new insert (not a duplicate)
    if (result.rowCount && result.rowCount > 0) {
      await db.query(
        `UPDATE post_engagement SET like_count = like_count + 1, updated_at = NOW()
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
         SET engaged_at = NOW(), engagement_type = 'like'
         FROM active_epoch
         WHERE ea.post_uri = $1
           AND ea.viewer_did = $2
           AND ea.epoch_id = active_epoch.id
           AND ea.engaged_at IS NULL`,
        [subjectUri, authorDid]
      ).catch((err) => logger.warn({ err, subjectUri }, 'Attribution update failed'));
    }

    logger.debug({ uri, subjectUri }, 'Like indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert like');
    // Don't rethrow - log and continue processing other events
  }
}

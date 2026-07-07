/**
 * Like Handler
 *
 * Handles likes from Jetstream.
 * Stores the like record and increments engagement counter.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import type { IngestionEventOutcome } from '../outcomes.js';

interface LikeRecord {
  subject?: {
    uri: string;
    cid?: string;
  };
  createdAt?: string;
}

interface LikeInsertOutcomeRow {
  inserted?: boolean;
  subjectExists?: boolean;
}

export async function handleLike(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<IngestionEventOutcome> {
  const likeRecord = record as LikeRecord;

  const subjectUri = likeRecord.subject?.uri;
  if (!subjectUri) {
    logger.warn({ uri }, 'Like missing subject URI');
    return 'like-missing-subject';
  }

  const createdAt = likeRecord.createdAt ?? new Date().toISOString();

  try {
    // Insert like only if the referenced post exists in our system.
    // This filters out the vast majority of firehose likes (for posts we don't track).
    const result = await db.query<LikeInsertOutcomeRow>(
      `WITH subject AS (
         SELECT 1 FROM posts WHERE uri = $3 AND deleted = FALSE LIMIT 1
       ),
       inserted AS (
         INSERT INTO likes (uri, author_did, subject_uri, created_at)
         SELECT $1, $2, $3, $4
         FROM subject
         ON CONFLICT (uri) DO NOTHING
         RETURNING uri
       )
       SELECT
         EXISTS (SELECT 1 FROM inserted) AS "inserted",
         EXISTS (SELECT 1 FROM subject) AS "subjectExists"`,
      [uri, authorDid, subjectUri, createdAt]
    );
    const outcome = result.rows[0];
    const inserted = outcome?.inserted === true;
    const subjectExists = outcome?.subjectExists === true;

    // Only increment counter if this was a new insert (not a duplicate)
    if (inserted) {
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

      logger.debug({ uri, subjectUri }, 'Like indexed');
      return 'like-inserted';
    }

    logger.debug({ uri, subjectUri, subjectExists }, 'Like skipped (duplicate or untracked subject)');
    return subjectExists ? 'like-duplicate-noop' : 'like-untracked-ignored';
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert like');
    // Don't rethrow - log and continue processing other events
    return 'like-handler-error';
  }
}

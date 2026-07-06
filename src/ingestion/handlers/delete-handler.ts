/**
 * Delete Handler
 *
 * CRITICAL: This handler must be wired up from day one.
 * Missing deletions = serving content the author removed = broken trust.
 *
 * All deletions are SOFT deletes (set deleted=TRUE, never hard delete).
 * This preserves referential integrity for engagement records.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { COLLECTIONS } from '../jetstream.types.js';
import type { IngestionEventOutcome } from '../outcomes.js';

export async function handleDelete(uri: string, collection: string): Promise<IngestionEventOutcome> {
  try {
    switch (collection) {
      case COLLECTIONS.POST:
        {
          const postResult = await db.query(
            `UPDATE posts
             SET deleted = TRUE
             WHERE uri = $1 AND deleted = FALSE
             RETURNING uri`,
            [uri]
          );

          if (postResult.rowCount === 0) {
            logger.debug({ uri }, 'Duplicate post delete received; no state change');
            return 'delete-post-noop';
          }
        }
        logger.debug({ uri }, 'Post marked as deleted');
        return 'delete-post-applied';

      case COLLECTIONS.LIKE:
        {
          const likeResult = await db.query(
            `UPDATE likes
             SET deleted = TRUE
             WHERE uri = $1 AND deleted = FALSE
             RETURNING subject_uri`,
            [uri]
          );

          if (likeResult.rowCount === 0) {
            logger.debug({ uri }, 'Duplicate like delete received; no state change');
            return 'delete-like-noop';
          }

          if (likeResult.rows[0]?.subject_uri) {
            await db.query(
              `UPDATE post_engagement
               SET like_count = GREATEST(like_count - 1, 0), updated_at = NOW()
               WHERE post_uri = $1`,
              [likeResult.rows[0].subject_uri]
            );
          }
        }
        logger.debug({ uri }, 'Like marked as deleted');
        return 'delete-like-applied';

      case COLLECTIONS.REPOST:
        {
          const repostResult = await db.query(
            `UPDATE reposts
             SET deleted = TRUE
             WHERE uri = $1 AND deleted = FALSE
             RETURNING subject_uri`,
            [uri]
          );

          if (repostResult.rowCount === 0) {
            logger.debug({ uri }, 'Duplicate repost delete received; no state change');
            return 'delete-repost-noop';
          }

          if (repostResult.rows[0]?.subject_uri) {
            await db.query(
              `UPDATE post_engagement
               SET repost_count = GREATEST(repost_count - 1, 0), updated_at = NOW()
               WHERE post_uri = $1`,
              [repostResult.rows[0].subject_uri]
            );
          }
        }
        logger.debug({ uri }, 'Repost marked as deleted');
        return 'delete-repost-applied';

      case COLLECTIONS.FOLLOW:
        {
          const followResult = await db.query(
            `UPDATE follows
             SET deleted = TRUE
             WHERE uri = $1 AND deleted = FALSE
             RETURNING uri`,
            [uri]
          );

          if (followResult.rowCount === 0) {
            logger.debug({ uri }, 'Duplicate follow delete received; no state change');
            return 'delete-follow-noop';
          }
        }
        logger.debug({ uri }, 'Follow marked as deleted');
        return 'delete-follow-applied';

      default:
        // Ignore deletions for collections we don't track
        return 'delete-untracked-ignored';
    }
  } catch (err) {
    logger.error({ err, uri, collection }, 'Failed to handle deletion');
    // Don't rethrow - log and continue processing other events
    return 'delete-handler-error';
  }
}

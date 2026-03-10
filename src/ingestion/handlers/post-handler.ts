/**
 * Post Handler
 *
 * Handles new posts from Jetstream.
 * Uses UPSERT pattern to handle duplicates gracefully.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { getCurrentContentRules, checkContentRules, hasActiveContentRules } from '../../governance/content-filter.js';
import { classifyPost, type TopicVector } from '../../scoring/topics/classifier.js';
import { getTaxonomy } from '../../scoring/topics/taxonomy.js';
import { checkGovernanceGate, isGovernanceGateReady } from '../governance-gate.js';
import { classifyPostByEmbedding } from '../embedding-gate.js';
import { isEmbedderReady } from '../../scoring/topics/embedder.js';

/** AT Protocol content labels that indicate NSFW content. */
const NSFW_LABELS = new Set(['porn', 'sexual', 'graphic-media', 'nudity']);

/**
 * Check if a post record contains AT Protocol NSFW content labels.
 *
 * @param record - The raw post record from Jetstream
 * @returns True if any NSFW label is present
 */
function hasNsfwLabels(record: Record<string, unknown>): boolean {
  const labels = record?.labels as { values?: Array<{ val: string }> } | undefined;
  if (!labels?.values) return false;
  return labels.values.some((l) => NSFW_LABELS.has(l.val));
}

interface PostRecord {
  text?: string;
  langs?: string[];
  createdAt?: string;
  reply?: {
    root?: { uri: string };
    parent?: { uri: string };
  };
  embed?: {
    $type?: string;
    images?: Array<{ alt?: string; image?: unknown; aspectRatio?: unknown }>;
    video?: unknown;
    external?: { uri?: string; title?: string; description?: string };
    media?: {
      $type?: string;
      external?: { uri?: string; title?: string; description?: string };
    };
  };
  labels?: {
    values?: Array<{ val: string }>;
  };
}

export async function handlePost(
  uri: string,
  authorDid: string,
  cid: string,
  record: Record<string, unknown>
): Promise<void> {
  const postRecord = record as PostRecord;

  const text = postRecord.text ?? null;
  const langs = postRecord.langs ?? [];
  const createdAt = postRecord.createdAt ?? new Date().toISOString();

  // Extract reply info
  const replyRoot = postRecord.reply?.root?.uri ?? null;
  const replyParent = postRecord.reply?.parent?.uri ?? null;

  // Check for media
  const hasMedia = !!(postRecord.embed?.images?.length || postRecord.embed?.video);

  // Extract external embed URL for deduplication.
  // Only extract from external link embeds — NOT from quote-post references (embed.record.uri).
  let embedUrl: string | null = null;
  if (postRecord.embed?.external?.uri) {
    embedUrl = postRecord.embed.external.uri;
  } else if (postRecord.embed?.media?.external?.uri) {
    embedUrl = postRecord.embed.media.external.uri;
  }

  // Extract alt text from image embeds for topic classification.
  // Alt text is accessibility metadata — used for classification only,
  // NOT for content filtering or media gating (those check user-written text).
  const altTexts: string[] = [];
  if (postRecord.embed?.images && Array.isArray(postRecord.embed.images)) {
    for (const img of postRecord.embed.images) {
      if (img && typeof img === 'object' && 'alt' in img) {
        const alt = (img as { alt?: string }).alt;
        if (alt && alt.trim().length > 0) {
          altTexts.push(alt.trim());
        }
      }
    }
  }

  // Pre-ingestion NSFW label filtering: skip posts with AT Protocol content labels.
  // Fail-open: if the check fails, continue to keyword filtering / insertion.
  if (config.FILTER_NSFW_LABELS) {
    try {
      if (hasNsfwLabels(record)) {
        logger.debug({ uri, authorDid }, 'Post skipped by NSFW content label');
        return;
      }
    } catch (err) {
      logger.warn({ err, uri }, 'NSFW label check failed, continuing with post');
    }
  }

  // Media-without-text gate: skip media posts with insufficient text.
  // Images/videos without meaningful text are usually not on-topic content.
  if (config.INGESTION_MIN_TEXT_FOR_MEDIA > 0 && hasMedia && (!text || text.trim().length < config.INGESTION_MIN_TEXT_FOR_MEDIA)) {
    logger.debug({ uri, authorDid }, 'Post skipped: media with insufficient text');
    return;
  }

  // Pre-ingestion content filtering: skip posts that don't match include keywords.
  // Fail-open: if the filter check fails, insert anyway (cleanup handles it later).
  try {
    const rules = await getCurrentContentRules();
    if (hasActiveContentRules(rules)) {
      const filterResult = checkContentRules(text, rules);
      if (!filterResult.passes) {
        logger.debug(
          { uri, reason: filterResult.reason, keyword: filterResult.matchedKeyword },
          'Post skipped by content filter'
        );
        return;
      }
    }
  } catch (err) {
    logger.warn({ err, uri }, 'Content filter check failed, inserting post anyway');
  }

  // Classify post topics (fail-open: empty vector on error)
  let topicVector: TopicVector = {};
  try {
    const taxonomy = getTaxonomy();
    if (taxonomy.length > 0) {
      const classificationText = [text ?? '', ...altTexts].filter(Boolean).join(' ');
      const result = classifyPost(classificationText, taxonomy);
      topicVector = result.vector;
    }
  } catch (err) {
    logger.warn({ err, uri }, 'Topic classification failed, proceeding without topics');
  }

  // Governance relevance gate: reject posts below community relevance threshold.
  // Fail-open: gate disabled, not ready, or error → post passes through.
  if (config.INGESTION_GATE_ENABLED && isGovernanceGateReady()) {
    try {
      const gateResult = await checkGovernanceGate(topicVector);
      if (!gateResult.passes) {
        logger.debug(
          { uri, relevance: gateResult.relevance, authorDid },
          'Post rejected by governance gate: below community relevance threshold'
        );
        return;
      }
    } catch (err) {
      logger.warn({ err, uri }, 'Governance gate check failed, inserting post anyway');
    }
  }

  // Governance gate passed. Refine classification with embeddings if available.
  // The embedding produces a semantically accurate topic vector that replaces
  // the keyword-based vector. "fork in the road" and "fork the repository"
  // are trivially distinguishable in embedding space.
  // Fail-open: if embedder is unavailable, the keyword vector is stored as-is.
  if (config.TOPIC_EMBEDDING_ENABLED && isEmbedderReady()) {
    try {
      const classificationText = [text ?? '', ...altTexts].filter(Boolean).join(' ');
      const embResult = await classifyPostByEmbedding(classificationText);
      if (embResult && Object.keys(embResult.vector).length > 0) {
        topicVector = embResult.vector;
      }
      // If embedding produces empty vector but keywords had matches,
      // keep the keyword vector. The post already passed the governance gate
      // on keyword matches, so it's worth storing with keyword classification.
    } catch (err) {
      logger.warn({ err, uri }, 'Embedding classification failed at ingestion — using keyword vector');
    }
  }

  try {
    // UPSERT post - ON CONFLICT DO NOTHING handles duplicates
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, text, reply_root, reply_parent, langs, has_media, created_at, topic_vector, embed_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (uri) DO NOTHING`,
      [uri, cid, authorDid, text, replyRoot, replyParent, langs, hasMedia, createdAt, JSON.stringify(topicVector), embedUrl]
    );

    // Initialize engagement counters - UPSERT pattern
    await db.query(
      `INSERT INTO post_engagement (post_uri) VALUES ($1) ON CONFLICT DO NOTHING`,
      [uri]
    );

    // If this is a reply, increment reply count on the root post
    if (replyRoot) {
      await db.query(
        `UPDATE post_engagement SET reply_count = reply_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [replyRoot]
      );
    }

    logger.debug({ uri, authorDid }, 'Post indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert post');
    // Don't rethrow - log and continue processing other events
  }
}

/**
 * Admin Topic Management Routes
 *
 * CRUD endpoints for managing the topic catalog.
 * Topics drive the community-steerable relevance scoring component.
 *
 * GET    /api/admin/topics            - List all topics with stats
 * POST   /api/admin/topics            - Create a new topic
 * POST   /api/admin/topics/classify   - Test-classify text against taxonomy
 * POST   /api/admin/topics/:slug/backfill - Re-classify posts for a topic
 * PATCH  /api/admin/topics/:slug      - Update a topic
 * DELETE /api/admin/topics/:slug      - Soft deactivate a topic
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { getAdminDid } from '../../auth/admin.js';
import { loadTaxonomy, invalidateTaxonomyCache, getTopicsWithEmbeddings } from '../../scoring/topics/taxonomy.js';
import { classifyPost } from '../../scoring/topics/classifier.js';
import { classifyPostsBatch } from '../../scoring/topics/embedding-classifier.js';
import { isEmbedderReady } from '../../scoring/topics/embedder.js';

const CreateTopicSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  parentSlug: z.string().optional(),
  terms: z.array(z.string().min(1).max(50)).min(1).max(50),
  contextTerms: z.array(z.string().min(1).max(50)).max(30).default([]),
  antiTerms: z.array(z.string().min(1).max(50)).max(10).default([]),
});

const UpdateTopicSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  terms: z.array(z.string()).optional(),
  contextTerms: z.array(z.string()).optional(),
  antiTerms: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

const ClassifyTextSchema = z.object({
  text: z.string().min(1).max(5000),
});

/** Register topic management routes on the admin app. */
export function registerTopicRoutes(app: FastifyInstance): void {
  /**
   * GET /topics
   * List all topics with post counts and current community weights.
   */
  app.get('/topics', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Get all topics
    const topicsResult = await db.query(
      `SELECT slug, name, description, parent_slug, terms, context_terms, anti_terms,
              is_active, created_at
       FROM topic_catalog
       ORDER BY slug`
    );

    // Get post counts per topic using JSONB key existence
    const countsResult = await db.query(
      `SELECT key AS slug, count(*)::int AS post_count
       FROM posts, jsonb_each(topic_vector) AS kv(key, value)
       GROUP BY key`
    );
    const postCounts = new Map<string, number>();
    for (const row of countsResult.rows) {
      postCounts.set(row.slug, row.post_count);
    }

    // Get current epoch topic weights
    const epochResult = await db.query(
      `SELECT topic_weights FROM governance_epochs
       WHERE status = 'active'
       ORDER BY id DESC LIMIT 1`
    );
    const topicWeights: Record<string, number> = epochResult.rows[0]?.topic_weights ?? {};

    const topics = topicsResult.rows.map((row: Record<string, unknown>) => ({
      slug: row.slug,
      name: row.name,
      description: row.description ?? null,
      parentSlug: row.parent_slug ?? null,
      terms: row.terms ?? [],
      contextTerms: row.context_terms ?? [],
      antiTerms: row.anti_terms ?? [],
      isActive: row.is_active,
      postCount: postCounts.get(row.slug as string) ?? 0,
      currentWeight: topicWeights[row.slug as string] ?? null,
      createdAt: row.created_at,
    }));

    return reply.send(topics);
  });

  /**
   * POST /topics
   * Create a new topic in the catalog.
   */
  app.post('/topics', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateTopicSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw Errors.VALIDATION_ERROR('Invalid topic data', parseResult.error.issues);
    }

    const { slug, name, description, parentSlug, terms, contextTerms, antiTerms } = parseResult.data;
    const adminDid = getAdminDid(request);

    // Check for duplicate slug
    const existing = await db.query(
      `SELECT id FROM topic_catalog WHERE slug = $1`,
      [slug]
    );
    if (existing.rows.length > 0) {
      throw Errors.CONFLICT(`Topic with slug "${slug}" already exists`);
    }

    // Validate parentSlug exists if provided
    if (parentSlug) {
      const parent = await db.query(
        `SELECT id FROM topic_catalog WHERE slug = $1`,
        [parentSlug]
      );
      if (parent.rows.length === 0) {
        throw Errors.VALIDATION_ERROR(`Parent topic "${parentSlug}" not found`);
      }
    }

    // Normalize terms to lowercase
    const normalizedTerms = terms.map(t => t.toLowerCase());
    const normalizedContextTerms = contextTerms.map(t => t.toLowerCase());
    const normalizedAntiTerms = antiTerms.map(t => t.toLowerCase());

    await db.query(
      `INSERT INTO topic_catalog (slug, name, description, parent_slug, terms, context_terms, anti_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [slug, name, description ?? null, parentSlug ?? null,
       normalizedTerms, normalizedContextTerms, normalizedAntiTerms]
    );

    // Audit log
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ($1, $2, $3)`,
      ['topic_created', adminDid, JSON.stringify({ slug, name, terms: normalizedTerms })]
    );

    invalidateTaxonomyCache();

    logger.info({ slug, adminDid }, 'Topic created');

    return reply.code(201).send({
      success: true,
      topic: { slug, name, description, parentSlug, terms: normalizedTerms,
               contextTerms: normalizedContextTerms, antiTerms: normalizedAntiTerms },
    });
  });

  /**
   * POST /topics/classify
   * Test-classify text against the current taxonomy.
   * Debug tool for verifying topic matching quality.
   * MUST be registered BEFORE /topics/:slug routes.
   */
  app.post('/topics/classify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ClassifyTextSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw Errors.VALIDATION_ERROR('Invalid input', parseResult.error.issues);
    }

    const { text } = parseResult.data;

    // Force fresh taxonomy load to pick up any recent changes
    const taxonomy = await loadTaxonomy();
    const keywordResult = classifyPost(text, taxonomy);

    // If embedding classifier is available, include a comparison
    let embeddingResult = null;
    if (isEmbedderReady() && getTopicsWithEmbeddings()) {
      try {
        const embeddingMap = await classifyPostsBatch([{ uri: '__classify_test__', text }]);
        embeddingResult = embeddingMap.get('__classify_test__') ?? null;
      } catch {
        // Non-fatal: embedding comparison is supplementary
        embeddingResult = null;
      }
    }

    return reply.send({
      ...keywordResult,
      embedding: embeddingResult,
      embedding_available: isEmbedderReady() && getTopicsWithEmbeddings() !== null,
    });
  });

  /**
   * POST /topics/:slug/backfill
   * Re-classify existing posts for a specific topic.
   * Processes all posts in batches and updates topic_vector.
   */
  app.post(
    '/topics/:slug/backfill',
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;
      const adminDid = getAdminDid(request);

      // Verify topic exists
      const topicCheck = await db.query(
        `SELECT id FROM topic_catalog WHERE slug = $1`,
        [slug]
      );
      if (topicCheck.rows.length === 0) {
        throw Errors.NOT_FOUND('Topic');
      }

      const startTime = Date.now();

      // Force fresh taxonomy load
      const taxonomy = await loadTaxonomy();

      let totalClassified = 0;
      let totalMatched = 0;
      const BATCH_SIZE = 500;
      let offset = 0;

      while (true) {
        const postsResult = await db.query(
          `SELECT uri, COALESCE(text, '') AS text FROM posts
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [BATCH_SIZE, offset]
        );

        if (postsResult.rows.length === 0) break;

        const updates: Array<{ uri: string; vector: string }> = [];

        for (const row of postsResult.rows) {
          const result = classifyPost(row.text, taxonomy);
          totalClassified++;

          if (result.matchedTopics.includes(slug)) {
            totalMatched++;
          }

          updates.push({
            uri: row.uri,
            vector: JSON.stringify(result.vector),
          });
        }

        // Batch UPDATE using unnest
        if (updates.length > 0) {
          const uris = updates.map(u => u.uri);
          const vectors = updates.map(u => u.vector);

          await db.query(
            `UPDATE posts AS p SET topic_vector = v.vector::jsonb
             FROM (SELECT unnest($1::text[]) AS uri, unnest($2::text[]) AS vector) AS v
             WHERE p.uri = v.uri`,
            [uris, vectors]
          );
        }

        offset += postsResult.rows.length;
        if (postsResult.rows.length < BATCH_SIZE) break;
      }

      const elapsedMs = Date.now() - startTime;

      // Audit log
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ($1, $2, $3)`,
        ['topic_backfill', adminDid,
         JSON.stringify({ slug, classified: totalClassified, matched: totalMatched, elapsed_ms: elapsedMs })]
      );

      logger.info({ slug, classified: totalClassified, matched: totalMatched, elapsedMs }, 'Topic backfill complete');

      return reply.send({
        classified: totalClassified,
        matched: totalMatched,
        elapsed_ms: elapsedMs,
      });
    }
  );

  /**
   * PATCH /topics/:slug
   * Update a topic's fields. Only provided fields are changed.
   */
  app.patch(
    '/topics/:slug',
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;
      const adminDid = getAdminDid(request);

      const parseResult = UpdateTopicSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw Errors.VALIDATION_ERROR('Invalid update data', parseResult.error.issues);
      }

      const updates = parseResult.data;

      // Get current state for diff
      const current = await db.query(
        `SELECT name, description, terms, context_terms, anti_terms, is_active
         FROM topic_catalog WHERE slug = $1`,
        [slug]
      );
      if (current.rows.length === 0) {
        throw Errors.NOT_FOUND('Topic');
      }

      const before = current.rows[0];

      // Build dynamic SET clause
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIdx}`);
        values.push(updates.name);
        paramIdx++;
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIdx}`);
        values.push(updates.description);
        paramIdx++;
      }
      if (updates.terms !== undefined) {
        const normalized = updates.terms.map(t => t.toLowerCase());
        setClauses.push(`terms = $${paramIdx}`);
        values.push(normalized);
        paramIdx++;
      }
      if (updates.contextTerms !== undefined) {
        const normalized = updates.contextTerms.map(t => t.toLowerCase());
        setClauses.push(`context_terms = $${paramIdx}`);
        values.push(normalized);
        paramIdx++;
      }
      if (updates.antiTerms !== undefined) {
        const normalized = updates.antiTerms.map(t => t.toLowerCase());
        setClauses.push(`anti_terms = $${paramIdx}`);
        values.push(normalized);
        paramIdx++;
      }
      if (updates.isActive !== undefined) {
        setClauses.push(`is_active = $${paramIdx}`);
        values.push(updates.isActive);
        paramIdx++;
      }

      values.push(slug);
      const query = `UPDATE topic_catalog SET ${setClauses.join(', ')} WHERE slug = $${paramIdx} RETURNING *`;

      const result = await db.query(query, values);

      // Audit log with diff
      const after = result.rows[0];
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ($1, $2, $3)`,
        ['topic_updated', adminDid, JSON.stringify({
          slug,
          before: { name: before.name, terms: before.terms, is_active: before.is_active },
          after: { name: after.name, terms: after.terms, is_active: after.is_active },
        })]
      );

      invalidateTaxonomyCache();

      logger.info({ slug, adminDid }, 'Topic updated');

      return reply.send({ success: true, topic: after });
    }
  );

  /**
   * DELETE /topics/:slug
   * Soft deactivate a topic (sets is_active = false).
   * Does NOT delete from DB — topic vectors referencing it stay valid.
   */
  app.delete(
    '/topics/:slug',
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;
      const adminDid = getAdminDid(request);

      const result = await db.query(
        `UPDATE topic_catalog SET is_active = FALSE, updated_at = NOW()
         WHERE slug = $1 AND is_active = TRUE
         RETURNING id, name`,
        [slug]
      );

      if (result.rows.length === 0) {
        throw Errors.NOT_FOUND('Topic');
      }

      // Audit log
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ($1, $2, $3)`,
        ['topic_deactivated', adminDid, JSON.stringify({ slug, name: result.rows[0].name })]
      );

      invalidateTaxonomyCache();

      logger.info({ slug, adminDid }, 'Topic deactivated');

      return reply.send({ success: true });
    }
  );
}

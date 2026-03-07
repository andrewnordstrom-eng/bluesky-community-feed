/**
 * Research Export Routes
 *
 * Provides anonymized data export endpoints for research purposes.
 * All endpoints require admin authentication (via parent prefix hook).
 *
 * Endpoints:
 *   GET /export/votes       — Anonymized vote records per epoch
 *   GET /export/scores      — Score decomposition per epoch (Golden Rule)
 *   GET /export/engagement  — Engagement attribution per epoch
 *   GET /export/epochs      — Epoch metadata with weights
 *   GET /export/audit       — Audit log with date range filtering
 *   GET /export/full-dataset — ZIP bundle of all data for an epoch
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import archiver from 'archiver';
import { db } from '../../db/client.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { anonymizeDid } from '../../lib/anonymize.js';
import { startCsvStream } from '../../lib/csv-stream.js';
import { Errors } from '../../lib/errors.js';
import type {
  ExportVoteRecord,
  ExportScoreRecord,
  ExportEngagementRecord,
  ExportEpochRecord,
  ExportAuditRecord,
} from '../../shared/export-types.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const FormatSchema = z.enum(['json', 'csv']).default('json');
const EpochIdSchema = z.coerce.number().int().positive();

const VotesQuerySchema = z.object({
  epoch_id: EpochIdSchema,
  format: FormatSchema,
});

const ScoresQuerySchema = z.object({
  epoch_id: EpochIdSchema,
  format: FormatSchema,
  limit: z.coerce.number().min(1).max(10_000).default(1000),
  offset: z.coerce.number().min(0).default(0),
});

const EngagementQuerySchema = z.object({
  epoch_id: EpochIdSchema,
  format: FormatSchema,
});

const EpochsQuerySchema = z.object({
  format: FormatSchema,
});

const AuditQuerySchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: FormatSchema,
});

const FullDatasetQuerySchema = z.object({
  epoch_id: EpochIdSchema,
});

// ============================================================================
// Column Constants
// ============================================================================

const VOTE_COLUMNS = [
  'anon_voter_id', 'epoch_id',
  'recency_weight', 'engagement_weight', 'bridging_weight',
  'source_diversity_weight', 'relevance_weight',
  'include_keywords', 'exclude_keywords', 'topic_weight_votes', 'voted_at',
];

const SCORE_COLUMNS = [
  'post_uri', 'epoch_id',
  'recency_score', 'engagement_score', 'bridging_score',
  'source_diversity_score', 'relevance_score',
  'recency_weight', 'engagement_weight', 'bridging_weight',
  'source_diversity_weight', 'relevance_weight',
  'recency_weighted', 'engagement_weighted', 'bridging_weighted',
  'source_diversity_weighted', 'relevance_weighted',
  'total_score', 'topic_vector', 'classification_method', 'scored_at',
];

const ENGAGEMENT_COLUMNS = [
  'post_uri', 'anon_viewer_id', 'epoch_id',
  'engagement_type', 'position_in_feed', 'served_at', 'engaged_at',
];

const EPOCH_COLUMNS = [
  'id', 'status', 'phase',
  'recency_weight', 'engagement_weight', 'bridging_weight',
  'source_diversity_weight', 'relevance_weight',
  'vote_count', 'content_rules', 'topic_weights', 'created_at', 'closed_at',
  'voting_started_at', 'voting_closed_at',
];

const AUDIT_COLUMNS = [
  'id', 'action', 'anon_actor_id', 'epoch_id', 'details', 'created_at',
];

// ============================================================================
// Helpers
// ============================================================================

const salt = config.EXPORT_ANONYMIZATION_SALT;

/** Map a vote DB row to an export record. */
function mapVoteRow(row: Record<string, unknown>): ExportVoteRecord {
  return {
    anon_voter_id: anonymizeDid(row.voter_did as string, salt),
    epoch_id: row.epoch_id as number,
    recency_weight: row.recency_weight as number | null,
    engagement_weight: row.engagement_weight as number | null,
    bridging_weight: row.bridging_weight as number | null,
    source_diversity_weight: row.source_diversity_weight as number | null,
    relevance_weight: row.relevance_weight as number | null,
    include_keywords: (row.include_keywords as string[]) ?? [],
    exclude_keywords: (row.exclude_keywords as string[]) ?? [],
    topic_weight_votes: (row.topic_weight_votes as Record<string, number>) ?? null,
    voted_at: (row.voted_at as Date).toISOString(),
  };
}

/** Map a score DB row to an export record. */
function mapScoreRow(row: Record<string, unknown>): ExportScoreRecord {
  return {
    post_uri: row.post_uri as string,
    epoch_id: row.epoch_id as number,
    recency_score: row.recency_score as number,
    engagement_score: row.engagement_score as number,
    bridging_score: row.bridging_score as number,
    source_diversity_score: row.source_diversity_score as number,
    relevance_score: row.relevance_score as number,
    recency_weight: row.recency_weight as number,
    engagement_weight: row.engagement_weight as number,
    bridging_weight: row.bridging_weight as number,
    source_diversity_weight: row.source_diversity_weight as number,
    relevance_weight: row.relevance_weight as number,
    recency_weighted: row.recency_weighted as number,
    engagement_weighted: row.engagement_weighted as number,
    bridging_weighted: row.bridging_weighted as number,
    source_diversity_weighted: row.source_diversity_weighted as number,
    relevance_weighted: row.relevance_weighted as number,
    total_score: row.total_score as number,
    topic_vector: (row.topic_vector as Record<string, number>) ?? null,
    classification_method: (row.classification_method as 'keyword' | 'embedding') ?? 'keyword',
    scored_at: (row.scored_at as Date).toISOString(),
  };
}

/** Map an engagement DB row to an export record. */
function mapEngagementRow(row: Record<string, unknown>): ExportEngagementRecord {
  return {
    post_uri: row.post_uri as string,
    anon_viewer_id: anonymizeDid(row.viewer_did as string, salt),
    epoch_id: row.epoch_id as number,
    engagement_type: (row.engagement_type as string) ?? null,
    position_in_feed: (row.position_in_feed as number) ?? null,
    served_at: (row.served_at as Date).toISOString(),
    engaged_at: row.engaged_at ? (row.engaged_at as Date).toISOString() : null,
  };
}

/** Map an epoch DB row to an export record. */
function mapEpochRow(row: Record<string, unknown>): ExportEpochRecord {
  return {
    id: row.id as number,
    status: row.status as string,
    phase: (row.phase as string) ?? null,
    recency_weight: row.recency_weight as number,
    engagement_weight: row.engagement_weight as number,
    bridging_weight: row.bridging_weight as number,
    source_diversity_weight: row.source_diversity_weight as number,
    relevance_weight: row.relevance_weight as number,
    vote_count: row.vote_count as number,
    content_rules: (row.content_rules as Record<string, unknown>) ?? null,
    topic_weights: (row.topic_weights as Record<string, number>) ?? null,
    created_at: (row.created_at as Date).toISOString(),
    closed_at: row.closed_at ? (row.closed_at as Date).toISOString() : null,
    voting_started_at: row.voting_started_at
      ? (row.voting_started_at as Date).toISOString()
      : null,
    voting_closed_at: row.voting_closed_at
      ? (row.voting_closed_at as Date).toISOString()
      : null,
  };
}

/**
 * Recursively walk a JSONB object and anonymize any string value
 * that looks like a DID (starts with "did:"). This prevents raw
 * participant identities from leaking in audit log export details.
 */
function scrubDidsFromDetails(
  obj: unknown,
  anonSalt: string
): unknown {
  if (typeof obj === 'string') {
    return obj.startsWith('did:') ? anonymizeDid(obj, anonSalt) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => scrubDidsFromDetails(item, anonSalt));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = scrubDidsFromDetails(value, anonSalt);
    }
    return result;
  }
  return obj;
}

/** Map an audit DB row to an export record. */
function mapAuditRow(row: Record<string, unknown>): ExportAuditRecord {
  const rawDetails = (row.details as Record<string, unknown>) ?? {};
  return {
    id: row.id as number,
    action: row.action as string,
    anon_actor_id: row.actor_did
      ? anonymizeDid(row.actor_did as string, salt)
      : null,
    epoch_id: (row.epoch_id as number) ?? null,
    details: scrubDidsFromDetails(rawDetails, salt) as Record<string, unknown>,
    created_at: (row.created_at as Date).toISOString(),
  };
}

/** Flatten an export record to an array of values for CSV. */
function recordToValues(record: Record<string, unknown>, keys: string[]): (string | number | null | boolean)[] {
  return keys.map((key) => {
    const val = record[key];
    if (val === null || val === undefined) return null;
    if (Array.isArray(val)) return val.join(';');
    if (typeof val === 'object') return JSON.stringify(val);
    return val as string | number | boolean;
  });
}

// ============================================================================
// Route Registration
// ============================================================================

/** Register research data export routes. */
export function registerExportRoutes(app: FastifyInstance): void {
  // ── GET /export/votes ──
  app.get('/export/votes', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = VotesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { epoch_id, format } = parsed.data;

    const result = await db.query(
      `SELECT gv.voter_did, gv.epoch_id, gv.recency_weight, gv.engagement_weight,
              bridging_weight, source_diversity_weight, relevance_weight,
              include_keywords, exclude_keywords, topic_weight_votes, voted_at
       FROM governance_votes gv
       JOIN subscribers s ON s.did = gv.voter_did
       WHERE gv.epoch_id = $1
         AND s.research_consent IS TRUE
       ORDER BY gv.voted_at`,
      [epoch_id]
    );

    const records = result.rows.map(mapVoteRow);

    if (format === 'csv') {
      const csv = startCsvStream(reply, `votes-epoch-${epoch_id}.csv`, VOTE_COLUMNS);
      for (const record of records) {
        csv.writeRow(recordToValues(record as unknown as Record<string, unknown>, VOTE_COLUMNS));
      }
      csv.end();
      return;
    }

    return reply.send({ epoch_id, total: records.length, votes: records });
  });

  // ── GET /export/scores ──
  app.get('/export/scores', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ScoresQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { epoch_id, format, limit, offset } = parsed.data;

    const result = await db.query(
      `SELECT ps.post_uri, ps.epoch_id,
              ps.recency_score, ps.engagement_score, ps.bridging_score,
              ps.source_diversity_score, ps.relevance_score,
              ps.recency_weight, ps.engagement_weight, ps.bridging_weight,
              ps.source_diversity_weight, ps.relevance_weight,
              ps.recency_weighted, ps.engagement_weighted, ps.bridging_weighted,
              ps.source_diversity_weighted, ps.relevance_weighted,
              ps.total_score, p.topic_vector, ps.classification_method, ps.scored_at
       FROM post_scores ps
       LEFT JOIN posts p ON ps.post_uri = p.uri
       WHERE ps.epoch_id = $1
       ORDER BY ps.total_score DESC
       LIMIT $2 OFFSET $3`,
      [epoch_id, limit, offset]
    );

    const records = result.rows.map(mapScoreRow);

    if (format === 'csv') {
      const csv = startCsvStream(reply, `scores-epoch-${epoch_id}.csv`, SCORE_COLUMNS);
      for (const record of records) {
        csv.writeRow(recordToValues(record as unknown as Record<string, unknown>, SCORE_COLUMNS));
      }
      csv.end();
      return;
    }

    return reply.send({ epoch_id, total: records.length, limit, offset, scores: records });
  });

  // ── GET /export/engagement ──
  app.get('/export/engagement', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = EngagementQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { epoch_id, format } = parsed.data;

    const result = await db.query(
      `SELECT ea.post_uri, ea.viewer_did, ea.epoch_id, ea.engagement_type,
              position_in_feed, served_at, engaged_at
       FROM engagement_attributions ea
       JOIN subscribers s ON s.did = ea.viewer_did
       WHERE ea.epoch_id = $1
         AND s.research_consent IS TRUE
       ORDER BY ea.served_at`,
      [epoch_id]
    );

    const records = result.rows.map(mapEngagementRow);

    if (format === 'csv') {
      const csv = startCsvStream(reply, `engagement-epoch-${epoch_id}.csv`, ENGAGEMENT_COLUMNS);
      for (const record of records) {
        csv.writeRow(recordToValues(record as unknown as Record<string, unknown>, ENGAGEMENT_COLUMNS));
      }
      csv.end();
      return;
    }

    return reply.send({ epoch_id, total: records.length, engagement: records });
  });

  // ── GET /export/epochs ──
  app.get('/export/epochs', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = EpochsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { format } = parsed.data;

    const result = await db.query(
      `SELECT id, status, phase,
              recency_weight, engagement_weight, bridging_weight,
              source_diversity_weight, relevance_weight,
              vote_count, content_rules, topic_weights, created_at, closed_at,
              voting_started_at, voting_closed_at
       FROM governance_epochs
       ORDER BY id DESC`
    );

    const records = result.rows.map(mapEpochRow);

    if (format === 'csv') {
      const csv = startCsvStream(reply, 'epochs.csv', EPOCH_COLUMNS);
      for (const record of records) {
        csv.writeRow(recordToValues(record as unknown as Record<string, unknown>, EPOCH_COLUMNS));
      }
      csv.end();
      return;
    }

    return reply.send({ total: records.length, epochs: records });
  });

  // ── GET /export/audit ──
  app.get('/export/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = AuditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { start_date, end_date, format } = parsed.data;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (start_date) {
      conditions.push(`created_at >= $${paramIdx}::date`);
      params.push(start_date);
      paramIdx++;
    }
    if (end_date) {
      conditions.push(`created_at < ($${paramIdx}::date + interval '1 day')`);
      params.push(end_date);
      paramIdx++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await db.query(
      `SELECT id, action, actor_did, epoch_id, details, created_at
       FROM governance_audit_log
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    const records = result.rows.map(mapAuditRow);

    if (format === 'csv') {
      const csv = startCsvStream(reply, 'audit-log.csv', AUDIT_COLUMNS);
      for (const record of records) {
        csv.writeRow(recordToValues(record as unknown as Record<string, unknown>, AUDIT_COLUMNS));
      }
      csv.end();
      return;
    }

    return reply.send({ total: records.length, audit: records });
  });

  // ── GET /export/full-dataset ──
  app.get('/export/full-dataset', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = FullDatasetQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid query parameters', parsed.error.flatten());
    }
    const { epoch_id } = parsed.data;

    logger.info({ epoch_id }, 'Generating full dataset export');

    // Hijack the response to bypass Fastify serialization
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="epoch-${epoch_id}-dataset.zip"`,
    });

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(reply.raw);

    // 1. Votes CSV
    const votes = await db.query(
      `SELECT gv.voter_did, gv.epoch_id, gv.recency_weight, gv.engagement_weight,
              bridging_weight, source_diversity_weight, relevance_weight,
              include_keywords, exclude_keywords, topic_weight_votes, voted_at
       FROM governance_votes gv
       JOIN subscribers s ON s.did = gv.voter_did
       WHERE gv.epoch_id = $1
         AND s.research_consent IS TRUE
       ORDER BY gv.voted_at`,
      [epoch_id]
    );
    const votesCsv = buildCsvString(
      VOTE_COLUMNS,
      votes.rows.map(mapVoteRow),
      VOTE_COLUMNS
    );
    archive.append(votesCsv, { name: 'votes.csv' });

    // 2. Scores CSV (all rows for this epoch, chunked if needed)
    const scores = await db.query(
      `SELECT ps.post_uri, ps.epoch_id,
              ps.recency_score, ps.engagement_score, ps.bridging_score,
              ps.source_diversity_score, ps.relevance_score,
              ps.recency_weight, ps.engagement_weight, ps.bridging_weight,
              ps.source_diversity_weight, ps.relevance_weight,
              ps.recency_weighted, ps.engagement_weighted, ps.bridging_weighted,
              ps.source_diversity_weighted, ps.relevance_weighted,
              ps.total_score, p.topic_vector, ps.classification_method, ps.scored_at
       FROM post_scores ps
       LEFT JOIN posts p ON ps.post_uri = p.uri
       WHERE ps.epoch_id = $1 ORDER BY ps.total_score DESC`,
      [epoch_id]
    );
    const scoresCsv = buildCsvString(
      SCORE_COLUMNS,
      scores.rows.map(mapScoreRow),
      SCORE_COLUMNS
    );
    archive.append(scoresCsv, { name: 'scores.csv' });

    // 3. Engagement CSV
    const engagement = await db.query(
      `SELECT ea.post_uri, ea.viewer_did, ea.epoch_id, ea.engagement_type,
              position_in_feed, served_at, engaged_at
       FROM engagement_attributions ea
       JOIN subscribers s ON s.did = ea.viewer_did
       WHERE ea.epoch_id = $1
         AND s.research_consent IS TRUE
       ORDER BY ea.served_at`,
      [epoch_id]
    );
    const engagementCsv = buildCsvString(
      ENGAGEMENT_COLUMNS,
      engagement.rows.map(mapEngagementRow),
      ENGAGEMENT_COLUMNS
    );
    archive.append(engagementCsv, { name: 'engagement.csv' });

    // 4. Epoch metadata JSON
    const epoch = await db.query(
      `SELECT id, status, phase,
              recency_weight, engagement_weight, bridging_weight,
              source_diversity_weight, relevance_weight,
              vote_count, content_rules, topic_weights, created_at, closed_at,
              voting_started_at, voting_closed_at
       FROM governance_epochs WHERE id = $1`,
      [epoch_id]
    );
    const epochData = epoch.rows.length > 0 ? mapEpochRow(epoch.rows[0]) : null;
    archive.append(JSON.stringify(epochData, null, 2), { name: 'epoch_metadata.json' });

    // 5. Topic catalog JSON
    const topicCatalog = await db.query(
      `SELECT slug, name, description, parent_slug, terms, context_terms,
              anti_terms, is_active, created_at
       FROM topic_catalog ORDER BY slug`
    );
    const topicRecords = topicCatalog.rows.map((row: Record<string, unknown>) => ({
      slug: row.slug,
      name: row.name,
      description: row.description ?? null,
      parent_slug: row.parent_slug ?? null,
      terms: row.terms ?? [],
      context_terms: row.context_terms ?? [],
      anti_terms: row.anti_terms ?? [],
      is_active: row.is_active,
      created_at: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    }));
    archive.append(JSON.stringify(topicRecords, null, 2), { name: 'topics/catalog.json' });

    // 6. Topic community weights per epoch
    const topicWeights = await db.query(
      `SELECT id, topic_weights FROM governance_epochs
       WHERE topic_weights IS NOT NULL ORDER BY id`
    );
    const weightHistory = topicWeights.rows.map((row: Record<string, unknown>) => ({
      epoch_id: row.id,
      topic_weights: row.topic_weights,
    }));
    archive.append(JSON.stringify(weightHistory, null, 2), { name: 'topics/community-weights.json' });

    await archive.finalize();
  });

  logger.info('Export routes registered');
}

/**
 * Build a complete CSV string from records (for ZIP bundling).
 * Unlike startCsvStream, this returns a string instead of streaming.
 */
function buildCsvString<T extends object>(
  columns: string[],
  records: T[],
  keys: string[]
): string {
  const header = columns.join(',');
  const rows = records.map((record) =>
    recordToValues(record as unknown as Record<string, unknown>, keys)
      .map(csvEscapeValue)
      .join(',')
  );
  return '\ufeff' + header + '\n' + rows.join('\n') + '\n';
}

/** Escape a single CSV value. */
function csvEscapeValue(value: string | number | null | boolean): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

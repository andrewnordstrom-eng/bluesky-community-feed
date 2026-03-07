import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/config.js', () => ({
  config: {
    EXPORT_ANONYMIZATION_SALT: 'test-salt-at-least-16-chars',
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

import { registerExportRoutes } from '../src/admin/routes/export.js';
import { anonymizeDid } from '../src/lib/anonymize.js';

describe('export routes', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  // ── Votes ──

  describe('GET /export/votes', () => {
    const sampleVotes = [
      {
        voter_did: 'did:plc:alice',
        epoch_id: 1,
        recency_weight: 0.3,
        engagement_weight: 0.25,
        bridging_weight: 0.2,
        source_diversity_weight: 0.15,
        relevance_weight: 0.1,
        include_keywords: ['bluesky'],
        exclude_keywords: ['spam'],
        voted_at: new Date('2026-01-15T10:00:00Z'),
      },
      {
        voter_did: 'did:plc:bob',
        epoch_id: 1,
        recency_weight: 0.2,
        engagement_weight: 0.3,
        bridging_weight: 0.2,
        source_diversity_weight: 0.2,
        relevance_weight: 0.1,
        include_keywords: [],
        exclude_keywords: [],
        voted_at: new Date('2026-01-15T11:00:00Z'),
      },
    ];

    it('returns anonymized votes as JSON', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: sampleVotes });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/votes?epoch_id=1&format=json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.epoch_id).toBe(1);
      expect(body.total).toBe(2);
      expect(body.votes).toHaveLength(2);

      // Verify anonymization
      const expectedAliceId = anonymizeDid('did:plc:alice', 'test-salt-at-least-16-chars');
      expect(body.votes[0].anon_voter_id).toBe(expectedAliceId);
      expect(body.votes[0].anon_voter_id).toMatch(/^[0-9a-f]{16}$/);

      // Verify no raw DIDs leaked
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('did:plc:alice');
      expect(bodyStr).not.toContain('did:plc:bob');

      const voteSql = dbQueryMock.mock.calls[0][0] as string;
      expect(voteSql).toContain('JOIN subscribers s ON s.did = gv.voter_did');
      expect(voteSql).toContain('s.research_consent IS TRUE');

      // Verify weight data preserved
      expect(body.votes[0].recency_weight).toBe(0.3);
      expect(body.votes[0].include_keywords).toEqual(['bluesky']);

      await app.close();
    });

    it('returns CSV with correct headers', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: sampleVotes });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/votes?epoch_id=1&format=csv',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('votes-epoch-1.csv');

      const lines = response.body.split('\n').filter(Boolean);
      // First line after BOM is the header
      const header = lines[0].replace('\ufeff', '');
      expect(header).toContain('anon_voter_id');
      expect(header).toContain('epoch_id');
      expect(header).not.toContain('voter_did');

      await app.close();
    });

    it('returns 400 for missing epoch_id', async () => {
      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/votes?format=json',
      });

      expect(response.statusCode).toBe(400);
      await app.close();
    });
  });

  // ── Scores ──

  describe('GET /export/scores', () => {
    const sampleScores = [
      {
        post_uri: 'at://did:plc:author/app.bsky.feed.post/abc123',
        epoch_id: 1,
        recency_score: 0.8,
        engagement_score: 0.6,
        bridging_score: 0.4,
        source_diversity_score: 0.9,
        relevance_score: 0.5,
        recency_weight: 0.3,
        engagement_weight: 0.25,
        bridging_weight: 0.2,
        source_diversity_weight: 0.15,
        relevance_weight: 0.1,
        recency_weighted: 0.24,
        engagement_weighted: 0.15,
        bridging_weighted: 0.08,
        source_diversity_weighted: 0.135,
        relevance_weighted: 0.05,
        total_score: 0.655,
        scored_at: new Date('2026-01-15T12:00:00Z'),
      },
    ];

    it('returns all 15 score columns (Golden Rule)', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: sampleScores });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/scores?epoch_id=1&format=json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const score = body.scores[0];

      // All 5 raw scores
      expect(score.recency_score).toBe(0.8);
      expect(score.engagement_score).toBe(0.6);
      expect(score.bridging_score).toBe(0.4);
      expect(score.source_diversity_score).toBe(0.9);
      expect(score.relevance_score).toBe(0.5);

      // All 5 weights
      expect(score.recency_weight).toBe(0.3);
      expect(score.engagement_weight).toBe(0.25);

      // All 5 weighted values
      expect(score.recency_weighted).toBe(0.24);
      expect(score.engagement_weighted).toBe(0.15);

      // Total
      expect(score.total_score).toBe(0.655);

      await app.close();
    });

    it('respects limit and offset', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: sampleScores });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/scores?epoch_id=1&format=json&limit=50&offset=10',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(10);

      // Verify SQL params include limit and offset
      expect(dbQueryMock).toHaveBeenCalledTimes(1);
      const sqlParams = dbQueryMock.mock.calls[0][1];
      expect(sqlParams).toEqual([1, 50, 10]);

      await app.close();
    });
  });

  // ── Engagement ──

  describe('GET /export/engagement', () => {
    it('returns anonymized engagement data', async () => {
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:author/app.bsky.feed.post/abc',
            viewer_did: 'did:plc:viewer1',
            epoch_id: 1,
            engagement_type: 'like',
            position_in_feed: 3,
            served_at: new Date('2026-01-15T10:00:00Z'),
            engaged_at: new Date('2026-01-15T10:05:00Z'),
          },
        ],
      });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/engagement?epoch_id=1&format=json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.engagement[0].anon_viewer_id).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(body)).not.toContain('did:plc:viewer1');

      const engagementSql = dbQueryMock.mock.calls[0][0] as string;
      expect(engagementSql).toContain('JOIN subscribers s ON s.did = ea.viewer_did');
      expect(engagementSql).toContain('s.research_consent IS TRUE');

      await app.close();
    });
  });

  // ── Epochs ──

  describe('GET /export/epochs', () => {
    it('returns all epochs with weights', async () => {
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            status: 'active',
            phase: 'running',
            recency_weight: 0.3,
            engagement_weight: 0.25,
            bridging_weight: 0.2,
            source_diversity_weight: 0.15,
            relevance_weight: 0.1,
            vote_count: 12,
            content_rules: { include_keywords: [], exclude_keywords: [] },
            created_at: new Date('2026-01-10T00:00:00Z'),
            closed_at: null,
            voting_started_at: null,
            voting_closed_at: null,
          },
        ],
      });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/epochs?format=json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.epochs[0].recency_weight).toBe(0.3);
      expect(body.epochs[0].status).toBe('active');

      await app.close();
    });
  });

  // ── Audit ──

  describe('GET /export/audit', () => {
    it('returns anonymized audit log with date filtering', async () => {
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            action: 'epoch_created',
            actor_did: 'did:plc:admin',
            epoch_id: 1,
            details: { source: 'manual' },
            created_at: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/audit?start_date=2026-01-01&end_date=2026-01-31&format=json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.audit[0].anon_actor_id).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(body)).not.toContain('did:plc:admin');

      // Verify date params passed to SQL
      expect(dbQueryMock.mock.calls[0][1]).toEqual(['2026-01-01', '2026-01-31']);

      await app.close();
    });

    it('works without date filters', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/audit?format=json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(0);

      await app.close();
    });
  });

  // ── Full Dataset ──

  describe('GET /export/full-dataset', () => {
    it('returns ZIP content type', async () => {
      // Mock all 6 queries
      dbQueryMock
        .mockResolvedValueOnce({ rows: [] }) // votes
        .mockResolvedValueOnce({ rows: [] }) // scores
        .mockResolvedValueOnce({ rows: [] }) // engagement
        .mockResolvedValueOnce({ rows: [] }) // epoch
        .mockResolvedValueOnce({ rows: [] }) // topic catalog
        .mockResolvedValueOnce({ rows: [] }); // topic weights

      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/full-dataset?epoch_id=1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
      expect(response.headers['content-disposition']).toContain('epoch-1-dataset.zip');

      await app.close();
    });

    it('returns 400 for missing epoch_id', async () => {
      const app = Fastify();
      registerExportRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/export/full-dataset',
      });

      expect(response.statusCode).toBe(400);
      await app.close();
    });
  });

  // ── Anonymization Consistency ──

  describe('anonymization consistency', () => {
    it('same DID gets same anon ID across votes and engagement', async () => {
      const did = 'did:plc:consistent-user';
      const salt = 'test-salt-at-least-16-chars';
      const expectedAnonId = anonymizeDid(did, salt);

      dbQueryMock.mockResolvedValueOnce({
        rows: [{
          voter_did: did,
          epoch_id: 1,
          recency_weight: 0.2, engagement_weight: 0.2,
          bridging_weight: 0.2, source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          include_keywords: [], exclude_keywords: [],
          voted_at: new Date('2026-01-15T10:00:00Z'),
        }],
      });

      const app = Fastify();
      registerExportRoutes(app);

      const votesResponse = await app.inject({
        method: 'GET',
        url: '/export/votes?epoch_id=1&format=json',
      });

      const voteAnonId = votesResponse.json().votes[0].anon_voter_id;
      expect(voteAnonId).toBe(expectedAnonId);

      dbQueryMock.mockResolvedValueOnce({
        rows: [{
          post_uri: 'at://did:plc:x/app.bsky.feed.post/123',
          viewer_did: did,
          epoch_id: 1,
          engagement_type: 'like',
          position_in_feed: 1,
          served_at: new Date('2026-01-15T10:00:00Z'),
          engaged_at: new Date('2026-01-15T10:01:00Z'),
        }],
      });

      const engResponse = await app.inject({
        method: 'GET',
        url: '/export/engagement?epoch_id=1&format=json',
      });

      const engAnonId = engResponse.json().engagement[0].anon_viewer_id;
      expect(engAnonId).toBe(expectedAnonId);

      await app.close();
    });
  });
});

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { registerPostExplainRoute } from '../src/transparency/routes/post-explain.js';
import { registerFeedStatsRoute } from '../src/transparency/routes/feed-stats.js';
import { registerCounterfactualRoute } from '../src/transparency/routes/counterfactual.js';

describe('transparency routes current-run scoping', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('scopes feed stats to current scoring run when run metadata exists', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, status: 'active', recency_weight: 0.2, engagement_weight: 0.2, bridging_weight: 0.2, source_diversity_weight: 0.2, relevance_weight: 0.2, created_at: '2026-02-09T00:00:00.000Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ value: { run_id: 'run-1', epoch_id: 2 } }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_posts: '10', unique_authors: '8', avg_bridging: '0.3', avg_engagement: '0.4', median_bridging: '0.25', median_total: '0.5' }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerFeedStatsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/stats',
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[2]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });

  it('scopes counterfactual ranking query to current run', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, recency_weight: 0.2, engagement_weight: 0.2, bridging_weight: 0.2, source_diversity_weight: 0.2, relevance_weight: 0.2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ value: { run_id: 'run-2', epoch_id: 2 } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            recency_score: 0.8,
            engagement_score: 0.7,
            bridging_score: 0.6,
            source_diversity_score: 0.5,
            relevance_score: 0.4,
            total_score: 0.6,
          },
        ],
      });

    const app = Fastify();
    registerCounterfactualRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/counterfactual',
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[2]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });

  it('scopes post explanation rank calculations to current run', async () => {
    // Post-PROJ-817 with read flag flipped to true:
    //   0: epoch lookup
    //   1: current-scoring-run scope
    //   2: readPostScore long-path #1 — post_scores header
    //   3: readPostScore long-path #2 — post_score_components SELECT
    //   4: rank query (total_score)  ← assertion target
    //   5: countPostsWithComponentAbove long-path JOIN  ← assertion target
    //   6: topic_vector (try-block, non-fatal)
    //   7: topic_weights (try-block, non-fatal)
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 3, description: 'epoch' }] })
      .mockResolvedValueOnce({ rows: [{ value: { run_id: 'run-3', epoch_id: 3 } }] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            epoch_id: 3,
            total_score: 0.7,
            scored_at: '2026-02-09T00:00:00.000Z',
            classification_method: 'keyword',
            component_details: { run_id: 'run-3' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { component_key: 'recency', raw: '0.8', weight: '0.2', weighted: '0.16' },
          { component_key: 'engagement', raw: '0.6', weight: '0.2', weighted: '0.12' },
          { component_key: 'bridging', raw: '0.5', weight: '0.2', weighted: '0.1' },
          { component_key: 'sourceDiversity', raw: '0.4', weight: '0.2', weighted: '0.08' },
          { component_key: 'relevance', raw: '0.3', weight: '0.2', weighted: '0.06' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ rank: '2' }] })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    // Safety net for any unscripted call — prevents undefined.rows throws.
    dbQueryMock.mockResolvedValue({ rows: [] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:a/app.bsky.feed.post/1')}`,
    });

    expect(response.statusCode).toBe(200);
    // Rank-by-total query (call 4) and counterfactual long-path JOIN (call 5)
    // both filter on component_details->>'run_id' when a scoped run exists.
    expect(String(dbQueryMock.mock.calls[4]?.[0])).toContain("component_details->>'run_id'");
    expect(String(dbQueryMock.mock.calls[5]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });
});

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

  it('does not scope counterfactual rankings to the latest incremental run', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, recency_weight: 0.2, engagement_weight: 0.2, bridging_weight: 0.2, source_diversity_weight: 0.2, relevance_weight: 0.2 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            total_score: '0.6',
            components_raw: {
              recency: '0.8',
              engagement: '0.7',
              bridging: '0.6',
              sourceDiversity: '0.5',
              relevance: '0.4',
            },
            components_weight: {
              recency: '0.2',
              engagement: '0.2',
              bridging: '0.2',
              sourceDiversity: '0.2',
              relevance: '0.2',
            },
            components_weighted: {
              recency: '0.16',
              engagement: '0.14',
              bridging: '0.12',
              sourceDiversity: '0.1',
              relevance: '0.08',
            },
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
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    expect(String(dbQueryMock.mock.calls[1]?.[0])).not.toContain("component_details->>'run_id'");
    expect(dbQueryMock.mock.calls.some(([query]) => String(query).includes('system_status'))).toBe(false);

    await app.close();
  });

  it('resolves post explanations for scores from older incremental runs', async () => {
    // Post-PROJ-817 with read flag flipped to true:
    //   0: epoch lookup
    //   1: readPostScore long-path #1 — post_scores header
    //   2: readPostScore long-path #2 — post_score_components SELECT
    //   3: rank query (total_score)  ← assertion target
    //   4: countPostsWithComponentAbove long-path JOIN  ← assertion target
    //   5: topic_vector (try-block, non-fatal)
    //   6: topic_weights (try-block, non-fatal)
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 3, description: 'epoch' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            epoch_id: 3,
            total_score: 0.7,
            scored_at: '2026-02-09T00:00:00.000Z',
            classification_method: 'keyword',
            component_details: { run_id: 'older-run' },
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
      .mockResolvedValueOnce({ rows: [{ topic_vector: { atproto: 0.8 } }] })
      .mockResolvedValueOnce({ rows: [{ topic_weights: { atproto: 0.5 } }] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:a/app.bsky.feed.post/1')}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      components: { relevance: { topicBreakdown?: Record<string, unknown> } };
    };
    expect(body.components.relevance.topicBreakdown?.atproto).toEqual({
      postScore: 0.8,
      communityWeight: 0.5,
      contribution: 0.4,
    });
    // The initial score lookup is epoch-scoped so older incremental-run rows
    // can resolve. Rank-by-total query (call 3) and counterfactual long-path
    // JOIN (call 4) still filter on the resolved score row's run_id.
    expect(String(dbQueryMock.mock.calls[1]?.[0])).not.toContain("component_details->>'run_id'");
    expect(String(dbQueryMock.mock.calls[3]?.[0])).toContain("component_details->>'run_id'");
    expect(String(dbQueryMock.mock.calls[4]?.[0])).toContain("component_details->>'run_id'");
    expect(dbQueryMock.mock.calls[3]?.[1]).toEqual([3, 0.7, 'older-run']);
    expect(dbQueryMock.mock.calls[4]?.[1]).toEqual([3, 'engagement', 0.6, 'older-run']);
    expect(dbQueryMock.mock.calls.some(([query]) => String(query).includes('system_status'))).toBe(false);
    expect(dbQueryMock).toHaveBeenCalledTimes(7);

    await app.close();
  });

  it('does not scope post explanation rank calculations when the score row has no run id', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 3, description: 'epoch' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            epoch_id: 3,
            total_score: 0.7,
            scored_at: '2026-02-09T00:00:00.000Z',
            classification_method: 'keyword',
            component_details: {},
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
      .mockResolvedValueOnce({ rows: [{ topic_vector: {} }] })
      .mockResolvedValueOnce({ rows: [{ topic_weights: {} }] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:a/app.bsky.feed.post/1')}`,
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[3]?.[0])).not.toContain("component_details->>'run_id'");
    expect(String(dbQueryMock.mock.calls[4]?.[0])).not.toContain("component_details->>'run_id'");
    expect(dbQueryMock.mock.calls.some(([query]) => String(query).includes('system_status'))).toBe(false);
    expect(dbQueryMock).toHaveBeenCalledTimes(7);

    await app.close();
  });

  it('returns a controlled error for invalid score timestamps', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 3, description: 'epoch' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            epoch_id: 3,
            total_score: 0.7,
            scored_at: 'not-a-date',
            classification_method: 'keyword',
            component_details: { run_id: 'run-3' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { component_key: 'recency', raw: '0.8', weight: '0.2', weighted: '0.16' },
          { component_key: 'engagement', raw: '0.6', weight: '0.2', weighted: '0.12' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ rank: '2' }] })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:a/app.bsky.feed.post/1')}`,
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('ScoreTimestampInvalid');

    await app.close();
  });
});

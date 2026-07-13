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

vi.mock('../src/config.js', () => ({
  config: {
    BOT_ADMIN_DIDS: 'did:plc:admin',
    GOVERNANCE_LONGTABLE_READ_ENABLED: false,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../src/governance/auth.js', () => ({
  getAuthenticatedDid: vi.fn().mockResolvedValue('did:plc:admin'),
  SessionStoreUnavailableError: class extends Error {},
}));

import { registerWeightsRoute } from '../src/governance/routes/weights.js';
import { registerEpochsRoute } from '../src/governance/routes/epochs.js';

describe('governance route query validation', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('returns 400 for invalid weights history limit', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerWeightsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/weights/history?limit=0',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 when compare endpoint receives same epoch ids', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerWeightsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/weights/compare?epoch1=5&epoch2=5',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 for invalid epochs list status', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/epochs?status=invalid',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 for invalid epoch id parameter', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/epochs/not-a-number',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns approval provenance and counts only approved active pilot participants', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 4,
          status: 'active',
          phase: 'running',
          recency_weight: 0.2,
          engagement_weight: 0.2,
          bridging_weight: 0.2,
          source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          vote_count: 3,
          created_at: '2026-07-13T00:00:00.000Z',
          closed_at: null,
          results_approved_at: '2026-07-13T01:00:00.000Z',
          description: null,
          content_rules: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const historyResponse = await app.inject({ method: 'GET', url: '/api/governance/epochs?limit=1' });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().epochs[0]).toMatchObject({
      id: 4,
      results_approved_at: '2026-07-13T01:00:00.000Z',
    });

    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 4,
          status: 'active',
          phase: 'running',
          recency_weight: 0.2,
          engagement_weight: 0.2,
          bridging_weight: 0.2,
          source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          vote_count: 3,
          created_at: '2026-07-13T00:00:00.000Z',
          closed_at: null,
          description: null,
          content_rules: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const currentResponse = await app.inject({ method: 'GET', url: '/api/governance/epochs/current' });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json()).toMatchObject({ subscriber_count: 2 });
    const subscriberQuery = String(dbQueryMock.mock.calls.at(-1)?.[0]);
    expect(subscriberQuery).toContain('INNER JOIN approved_participants');
    expect(subscriberQuery).toContain('ap.removed_at IS NULL');

    await app.close();
  });

  it('preserves null approval provenance for a round awaiting operator review', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          status: 'active',
          phase: 'results',
          recency_weight: 0.2,
          engagement_weight: 0.2,
          bridging_weight: 0.2,
          source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          created_at: '2026-07-13T00:00:00.000Z',
          closed_at: null,
          results_approved_at: null,
          description: null,
          content_rules: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const response = await app.inject({ method: 'GET', url: '/api/governance/epochs?limit=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().epochs[0].results_approved_at).toBeNull();
    await app.close();
  });

  it('returns zero when no approved active governance participants exist', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          status: 'active',
          phase: 'running',
          recency_weight: 0.2,
          engagement_weight: 0.2,
          bridging_weight: 0.2,
          source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          created_at: '2026-07-13T00:00:00.000Z',
          closed_at: null,
          description: null,
          content_rules: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const response = await app.inject({ method: 'GET', url: '/api/governance/epochs/current' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ vote_count: 0, subscriber_count: 0 });
    await app.close();
  });

  it('rejects the authenticated direct transition endpoint', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/epochs/transition',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'DirectTransitionDisabled' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });
});

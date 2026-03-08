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

import { registerAuditLogRoute } from '../src/transparency/routes/audit-log.js';
import { registerAuditLogRoutes } from '../src/admin/routes/audit-log.js';

describe('audit log redaction', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('redacts identity and vote payload details on public transparency route', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            action: 'vote_cast',
            actor_did: 'did:plc:voter',
            epoch_id: 7,
            details: {
              weights: {
                recency: 0.3,
                engagement: 0.2,
              },
              content_vote: {
                include_keywords: ['atproto', 'pds'],
                exclude_keywords: ['nsfw'],
              },
            },
            created_at: '2026-02-10T00:00:00.000Z',
          },
          {
            id: 11,
            action: 'epoch_transition',
            actor_did: 'did:plc:admin',
            epoch_id: 7,
            details: {
              from_epoch: 6,
              to_epoch: 7,
            },
            created_at: '2026-02-10T00:01:00.000Z',
          },
        ],
      });

    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerAuditLogRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/audit?limit=20&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      action: 'vote_cast',
      actor_did: null,
      details: {
        hasWeights: true,
        hasContentVote: true,
        includeKeywordCount: 2,
        excludeKeywordCount: 1,
        epochId: 7,
      },
    });
    expect(body.entries[1]).toMatchObject({
      action: 'epoch_transition',
      actor_did: null,
      details: {
        from_epoch: 6,
        to_epoch: 7,
      },
    });

    await app.close();
  });

  it('keeps full audit details on admin route', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            action: 'vote_updated',
            actor_did: 'did:plc:voter2',
            epoch_id: 7,
            details: {
              weights: {
                recency: 0.25,
                engagement: 0.25,
              },
            },
            created_at: '2026-02-10T00:02:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const app = Fastify();
    registerAuditLogRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/audit-log?limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries[0]).toMatchObject({
      actor: 'did:plc:voter2',
      details: {
        weights: {
          recency: 0.25,
          engagement: 0.25,
        },
      },
    });

    await app.close();
  });
});

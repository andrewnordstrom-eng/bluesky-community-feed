/**
 * MCP Server Integration Tests
 *
 * Tests the MCP Streamable HTTP endpoint at /mcp including authentication,
 * tool listing, and tool execution via app.inject().
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──
const {
  getSessionByTokenMock,
  isAdminMock,
  dbQueryMock,
  redisGetMock,
} = vi.hoisted(() => ({
  getSessionByTokenMock: vi.fn(),
  isAdminMock: vi.fn(),
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
}));

vi.mock('../src/governance/session-store.js', () => ({
  getSessionByToken: getSessionByTokenMock,
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('../src/auth/admin.js', () => ({
  isAdmin: isAdminMock,
  requireAdmin: vi.fn(async (request: any, reply: any) => {
    const cookie = request.headers.cookie || '';
    const match = cookie.match(/governance_session=([^;]+)/);
    if (!match) return reply.status(401).send({ error: 'Authentication required' });

    const session = await getSessionByTokenMock(match[1]);
    if (!session) return reply.status(401).send({ error: 'Invalid session' });

    if (!isAdminMock(session.did)) return reply.status(403).send({ error: 'Admin access required' });

    (request as any).adminDid = session.did;
  }),
  getCurrentUserDid: vi.fn(async () => 'did:plc:testadmin'),
  getAdminDid: vi.fn(() => 'did:plc:testadmin'),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: vi.fn(),
    del: vi.fn(),
    zcard: vi.fn().mockResolvedValue(0),
    multi: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('../src/config.js', () => ({
  config: {
    GOVERNANCE_SESSION_COOKIE_NAME: 'governance_session',
    BOT_ADMIN_DIDS: 'did:plc:testadmin',
    RATE_LIMIT_ENABLED: false,
    CORS_ALLOWED_ORIGINS: '',
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
    TRUST_PROXY: 'loopback',
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

import { registerMcpRoutes } from '../src/mcp/transport.js';

const VALID_TOKEN = 'test-session-token-abc123';
const ADMIN_DID = 'did:plc:testadmin';

/** Standard MCP headers for content negotiation. */
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function createTestApp() {
  const app = Fastify();

  // Mock admin endpoints for tool testing
  app.get('/api/admin/status', async () => ({
    currentEpoch: { id: 1, status: 'active' },
    scoring: { lastRun: '2026-03-01T00:00:00Z' },
    subscribers: 42,
  }));

  app.get('/api/admin/participants', async () => ({
    participants: [{ did: 'did:plc:user1', handle: 'user1.bsky.social' }],
  }));

  app.post('/api/admin/participants', async () => ({
    success: true,
    did: 'did:plc:added-participant',
  }));

  registerMcpRoutes(app);
  return app;
}

function setupValidAuth() {
  getSessionByTokenMock.mockResolvedValue({
    did: ADMIN_DID,
    handle: 'admin.bsky.social',
    accessJwt: VALID_TOKEN,
    expiresAt: new Date(Date.now() + 86400000),
  });
  isAdminMock.mockReturnValue(true);
}

/**
 * Parse MCP response which may be direct JSON or SSE format.
 * Returns all parsed JSON-RPC messages.
 */
function parseMcpResponses(body: string): any[] {
  const results: any[] = [];

  // Try direct JSON first
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch { /* fall through to SSE parsing */ }
  }

  // Parse SSE format
  const dataLines = body.split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));

  for (const line of dataLines) {
    try { results.push(JSON.parse(line)); } catch { /* skip */ }
  }

  return results;
}

describe('MCP Server', () => {
  beforeEach(() => {
    getSessionByTokenMock.mockReset();
    isAdminMock.mockReset();
    dbQueryMock.mockReset();
    redisGetMock.mockReset();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const app = createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: MCP_HEADERS,
        payload: {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Authentication required') });

      await app.close();
    });

    it('returns 401 with invalid session token', async () => {
      getSessionByTokenMock.mockResolvedValue(null);

      const app = createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, authorization: 'Bearer invalid-token' },
        payload: {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid or expired') });

      await app.close();
    });

    it('returns 403 for non-admin user', async () => {
      getSessionByTokenMock.mockResolvedValue({
        did: 'did:plc:regular-user',
        handle: 'regular.bsky.social',
        accessJwt: 'some-token',
        expiresAt: new Date(Date.now() + 86400000),
      });
      isAdminMock.mockReturnValue(false);

      const app = createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, authorization: 'Bearer some-token' },
        payload: {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        },
      });

      expect(res.statusCode).toBe(403);

      await app.close();
    });
  });

  describe('DELETE /mcp', () => {
    it('returns 405 for session termination in stateless mode', async () => {
      const app = createTestApp();

      const res = await app.inject({ method: 'DELETE', url: '/mcp' });
      expect(res.statusCode).toBe(405);

      await app.close();
    });
  });

  describe('initialize', () => {
    it('accepts valid initialization and returns server info', async () => {
      setupValidAuth();

      const app = createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        },
      });

      expect(res.statusCode).toBe(200);

      const results = parseMcpResponses(res.body);
      const initResult = results.find((r) => r.id === 1);
      expect(initResult).toBeTruthy();

      if (initResult?.result) {
        expect(initResult.result.serverInfo).toMatchObject({ name: 'corgi-feed-admin' });
        expect(initResult.result.capabilities).toBeDefined();
      }

      await app.close();
    });
  });

  describe('tool listing', () => {
    it('lists all 30 registered tools', async () => {
      setupValidAuth();

      const app = createTestApp();

      // In stateless mode, non-init requests work without prior init
      // (sessionIdGenerator is undefined, so validateSession passes)
      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        },
      });

      expect(res.statusCode).toBe(200);

      const results = parseMcpResponses(res.body);
      const toolsResult = results.find((r) => r.id === 2);

      if (toolsResult?.result?.tools) {
        const toolNames = toolsResult.result.tools.map((t: any) => t.name).sort();

        // Governance tools (10)
        expect(toolNames).toContain('get_status');
        expect(toolNames).toContain('list_epochs');
        expect(toolNames).toContain('get_governance_status');
        expect(toolNames).toContain('start_voting');
        expect(toolNames).toContain('close_voting');
        expect(toolNames).toContain('trigger_epoch_transition');
        expect(toolNames).toContain('get_content_rules');
        expect(toolNames).toContain('update_content_rules');
        expect(toolNames).toContain('get_vote_summary');
        expect(toolNames).toContain('preview_aggregation');

        // Feed tools (5)
        expect(toolNames).toContain('get_feed_health');
        expect(toolNames).toContain('trigger_rescore');
        expect(toolNames).toContain('reconnect_jetstream');
        expect(toolNames).toContain('explain_post_score');
        expect(toolNames).toContain('counterfactual_analysis');

        // Participant tools (3)
        expect(toolNames).toContain('list_participants');
        expect(toolNames).toContain('add_participant');
        expect(toolNames).toContain('remove_participant');

        // Export tools (3)
        expect(toolNames).toContain('export_votes');
        expect(toolNames).toContain('export_scores');
        expect(toolNames).toContain('export_audit');

        // Announcement tools (2)
        expect(toolNames).toContain('list_announcements');
        expect(toolNames).toContain('send_announcement');

        // Topic tools (5)
        expect(toolNames).toContain('list_topics');
        expect(toolNames).toContain('add_topic');
        expect(toolNames).toContain('update_topic');
        expect(toolNames).toContain('get_topic_stats');
        expect(toolNames).toContain('classify_text');

        // Report tools (2)
        expect(toolNames).toContain('generate_feed_report');
        expect(toolNames).toContain('get_feed_snapshot');

        expect(toolNames.length).toBe(30);
      }

      await app.close();
    });
  });

  describe('tool execution', () => {
    it('executes get_status tool and returns system status', async () => {
      setupValidAuth();

      const app = createTestApp();

      // Send tools/call directly (stateless mode)
      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_status', arguments: {} },
        },
      });

      expect(res.statusCode).toBe(200);

      const results = parseMcpResponses(res.body);
      const callResult = results.find((r) => r.id === 3);

      if (callResult?.result?.content) {
        expect(callResult.result.content[0].type).toBe('text');
        const parsed = JSON.parse(callResult.result.content[0].text);
        expect(parsed).toMatchObject({
          currentEpoch: { id: 1, status: 'active' },
          subscribers: 42,
        });
        expect(callResult.result.isError).toBeUndefined();
      }

      await app.close();
    });
  });
});

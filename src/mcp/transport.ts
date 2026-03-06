/**
 * MCP Transport & Route Mounting
 *
 * Registers Streamable HTTP MCP routes on the Fastify server.
 * Authenticates via Bearer token → Redis session → admin DID check.
 * Uses reply.hijack() to hand response control to the MCP transport.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getSessionByToken } from '../governance/session-store.js';
import { isAdmin } from '../auth/admin.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { createMcpServer } from './server.js';

/**
 * Extract Bearer token from Authorization header.
 * Returns null if missing or malformed.
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate the Bearer token: check session exists in Redis and DID is admin.
 * Returns the token if valid, or sends an error response and returns null.
 */
async function validateAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const token = extractBearerToken(request);
  if (!token) {
    reply.status(401).send({ error: 'Authentication required. Provide Authorization: Bearer <session-token>' });
    return null;
  }

  let session;
  try {
    session = await getSessionByToken(token);
  } catch (err) {
    logger.error({ err }, 'MCP auth: session store error');
    reply.status(503).send({ error: 'Authentication service temporarily unavailable' });
    return null;
  }

  if (!session) {
    reply.status(401).send({ error: 'Invalid or expired session token' });
    return null;
  }

  if (!isAdmin(session.did)) {
    logger.warn({ did: session.did }, 'MCP access attempted by non-admin');
    reply.status(403).send({ error: 'Admin access required' });
    return null;
  }

  return token;
}

/** Register MCP Streamable HTTP routes on the Fastify app. */
export function registerMcpRoutes(app: FastifyInstance): void {
  // POST /mcp — handles JSON-RPC requests (tool calls, tool listing, etc.)
  app.post('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = await validateAuth(request, reply);
    if (!token) return;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    const server = createMcpServer(app, token, config.GOVERNANCE_SESSION_COOKIE_NAME);

    // Connect server to transport (registers message handlers)
    await server.connect(transport);

    // Hijack the response so the MCP transport controls it directly
    reply.hijack();

    // Pass the request to the transport for handling
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // GET /mcp — SSE stream for server-sent events (notifications)
  app.get('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = await validateAuth(request, reply);
    if (!token) return;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = createMcpServer(app, token, config.GOVERNANCE_SESSION_COOKIE_NAME);
    await server.connect(transport);

    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw);
  });

  // DELETE /mcp — not supported in stateless mode
  app.delete('/mcp', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(405).send({ error: 'Session termination not supported in stateless mode' });
  });

  logger.info('MCP Streamable HTTP routes registered at /mcp');
}

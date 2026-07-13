/**
 * Auth Route
 *
 * POST /api/governance/auth/login - Authenticate with Bluesky
 * GET /api/governance/auth/session - Get current session info
 * POST /api/governance/auth/logout - Logout and invalidate session
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  authenticateWithBluesky,
  extractSessionToken,
  getSession,
  invalidateSession,
  SessionStoreUnavailableError,
} from '../auth.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { isAdmin } from '../../auth/admin.js';
import { isParticipantApproved } from '../../feed/access-control.js';
import { zodToOpenApi, ErrorResponseSchema, RateLimitResponseSchema, governanceSecurity } from '../../lib/openapi.js';

const LoginSchema = z.object({
  handle: z.string().min(1, 'Handle is required'),
  appPassword: z.string().min(1, 'App password is required'),
});

function formatSameSite(value: 'strict' | 'lax' | 'none'): 'Strict' | 'Lax' | 'None' {
  switch (value) {
    case 'strict':
      return 'Strict';
    case 'none':
      return 'None';
    default:
      return 'Lax';
  }
}

function shouldUseSecureCookie(): boolean {
  return config.NODE_ENV === 'production' || config.GOVERNANCE_SESSION_COOKIE_SAME_SITE === 'none';
}

function serializeSessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${config.GOVERNANCE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `SameSite=${formatSameSite(config.GOVERNANCE_SESSION_COOKIE_SAME_SITE)}`,
    `Expires=${expiresAt.toUTCString()}`,
  ];

  if (shouldUseSecureCookie()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function serializeClearedSessionCookie(): string {
  const parts = [
    `${config.GOVERNANCE_SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    `SameSite=${formatSameSite(config.GOVERNANCE_SESSION_COOKIE_SAME_SITE)}`,
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ];

  if (shouldUseSecureCookie()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function registerAuthRoute(app: FastifyInstance): void {
  /**
   * POST /api/governance/auth/login
   * Authenticate with Bluesky using handle + app password.
   * Returns session token for subsequent authenticated requests.
   */
  app.post('/api/governance/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with Bluesky credentials',
      description:
        'Authenticate using a Bluesky handle and app password. Returns a session cookie (HttpOnly) and bearer token. ' +
        'Use the cookie for browser-based governance actions, or the bearer token for CLI/MCP clients.',
      body: zodToOpenApi(LoginSchema),
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            did: { type: 'string', description: 'Authenticated user DID', example: 'did:plc:abc123' },
            handle: { type: 'string', description: 'Bluesky handle', example: 'alice.bsky.social' },
            expiresAt: { type: 'string', format: 'date-time', description: 'Session expiration timestamp' },
          },
          required: ['success', 'did', 'handle', 'expiresAt'],
        },
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: {
          type: 'object',
          description: 'Valid credentials, but the account is not approved for the pilot.',
          properties: {
            error: { type: 'string', example: 'NotApproved' },
            message: { type: 'string' },
            waitlist: { type: 'boolean', example: true, description: 'Discriminator: the client should offer the waitlist.' },
          },
          required: ['error', 'message', 'waitlist'],
        },
        429: RateLimitResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LoginSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { handle, appPassword } = parseResult.data;

    try {
      const session = await authenticateWithBluesky(handle, appPassword);

      if (!session) {
        return reply.code(401).send({
          error: 'AuthenticationFailed',
          message: 'Invalid handle or app password. Make sure you are using an app password from Bluesky settings.',
        });
      }

      // Pilot gating: credentials are valid, but only admins and approved
      // participants may hold a session. authenticateWithBluesky persisted
      // the session before we could gate it, so invalidate on deny — the
      // minted token must be dead, not merely unreturned.
      if (config.LOGIN_ALLOWLIST_ENABLED && !isAdmin(session.did)) {
        const approved = await isParticipantApproved(session.did);
        if (!approved) {
          try {
            await invalidateSession(session.accessJwt);
          } catch (invalidateErr) {
            // We can't guarantee the just-minted session is dead — refuse with
            // 503 (matching this file's SessionStoreUnavailable handling)
            // rather than a 403 that leaves a live session behind.
            logger.error({ err: invalidateErr, did: session.did }, 'Failed to invalidate unapproved session');
            return reply.code(503).send({
              error: 'SessionStoreUnavailable',
              message: 'Authentication service is temporarily unavailable. Please try again.',
            });
          }
          logger.info({ did: session.did, handle: session.handle }, 'Login denied: not an approved pilot participant');
          return reply.code(403).send({
            error: 'NotApproved',
            message: 'This Bluesky account is not approved for the Corgi voting pilot yet. Join the waitlist and we will get you in as we expand.',
            waitlist: true,
          });
        }
      }

      logger.info({ did: session.did, handle: session.handle }, 'User logged in');
      reply.header('set-cookie', serializeSessionCookie(session.accessJwt, session.expiresAt));

      return reply.send({
        success: true,
        did: session.did,
        handle: session.handle,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      logger.error({ err, handle }, 'Login error');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred during authentication',
      });
    }
  });

  /**
   * GET /api/governance/auth/session
   * Get current session info if authenticated.
   */
  app.get('/api/governance/auth/session', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current session',
      description: 'Returns the authenticated user\'s session info. Requires a valid session cookie or bearer token.',
      security: governanceSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            authenticated: { type: 'boolean', example: true },
            did: { type: 'string', description: 'Authenticated user DID', example: 'did:plc:abc123' },
            handle: { type: 'string', description: 'Bluesky handle', example: 'alice.bsky.social' },
            expiresAt: { type: 'string', format: 'date-time', description: 'Session expiration timestamp' },
          },
          required: ['authenticated', 'did', 'handle', 'expiresAt'],
        },
        401: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let session;
    try {
      session = await getSession(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }

    if (!session) {
      return reply.code(401).send({
        error: 'NotAuthenticated',
        message: 'No valid session found',
      });
    }

    return reply.send({
      authenticated: true,
      did: session.did,
      handle: session.handle,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  /**
   * POST /api/governance/auth/logout
   * Invalidate the current session.
   */
  app.post('/api/governance/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout and invalidate session',
      description: 'Invalidates the current session and clears the session cookie.',
      security: governanceSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Session invalidated' },
          },
          required: ['success', 'message'],
        },
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractSessionToken(request);
    reply.header('set-cookie', serializeClearedSessionCookie());

    if (!token) {
      return reply.send({ success: true, message: 'No session to invalidate' });
    }

    try {
      await invalidateSession(token);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }

    logger.info('User logged out');

    return reply.send({ success: true, message: 'Session invalidated' });
  });
}

/**
 * Admin Auth Helper
 *
 * Provides admin authentication utilities for the admin dashboard.
 * Checks if users are in the BOT_ADMIN_DIDS list.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getSession, SessionStoreUnavailableError } from '../governance/auth.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

/**
 * Parsed admin DID set — computed once at module load to avoid
 * re-splitting BOT_ADMIN_DIDS on every request.
 */
const ADMIN_DIDS: ReadonlySet<string> = (() => {
  const entries =
    config.BOT_ADMIN_DIDS?.split(',')
      .map((d) => d.trim())
      .filter(Boolean) || [];

  // Validate format at startup
  for (const entry of entries) {
    if (!entry.startsWith('did:')) {
      logger.warn({ entry }, 'BOT_ADMIN_DIDS contains entry without did: prefix — ignored');
    }
  }

  const validEntries = entries.filter((d) => d.startsWith('did:'));

  if (validEntries.length === 0) {
    logger.warn('BOT_ADMIN_DIDS is empty or contains no valid DIDs — no admin access possible');
  }

  return new Set(validEntries);
})();

/**
 * Check if a DID is in the admin list.
 */
export function isAdmin(did: string): boolean {
  return ADMIN_DIDS.has(did);
}

/**
 * Get the current user's DID from session, or null if not logged in.
 */
export async function getCurrentUserDid(request: FastifyRequest): Promise<string | null> {
  const session = await getSession(request);
  return session?.did || null;
}

/**
 * Fastify preHandler hook that requires admin access.
 * Returns 401 if not logged in, 403 if not admin.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  let did: string | null;
  try {
    did = await getCurrentUserDid(request);
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      logger.error({ err, path: request.url }, 'Admin auth check failed due to unavailable session store');
      return reply.status(503).send({ error: 'Authentication service temporarily unavailable' });
    }
    throw err;
  }

  if (!did) {
    logger.warn({ path: request.url }, 'Admin access attempted without login');
    return reply.status(401).send({ error: 'Authentication required' });
  }

  if (!isAdmin(did)) {
    logger.warn({ did, path: request.url }, 'Admin access attempted by non-admin');
    return reply.status(403).send({ error: 'Admin access required' });
  }

  // Attach admin DID to request for later use
  (request as any).adminDid = did;
}

/**
 * Get admin DID from request (after requireAdmin has run).
 */
export function getAdminDid(request: FastifyRequest): string {
  return (request as any).adminDid;
}

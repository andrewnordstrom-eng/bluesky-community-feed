/**
 * Test App Builder
 *
 * Creates a Fastify instance configured for testing via app.inject().
 *
 * NOTE: This is for use in test bodies, NOT inside vi.hoisted() callbacks.
 * The calling test file must set up vi.mock() declarations for db/redis/etc
 * before importing and calling these helpers.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

/**
 * Build a Fastify instance for route testing.
 * Mirrors production config: no-op validator so route schemas
 * are documentation-only (Zod safeParse handles validation).
 *
 * @example
 * const app = buildTestApp();
 * registerFeedSkeleton(app);
 * const res = await app.inject({ method: 'GET', url: '/...' });
 */
export function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(() => () => true);
  return app;
}

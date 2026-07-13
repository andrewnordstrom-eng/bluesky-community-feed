import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { config } from '../src/config.js';
import { buildRouteRateLimitConfig } from '../src/feed/rate-limit-config.js';

const noopKeyGenerator = (_request: FastifyRequest) => 'key';

describe('route rate-limit policy', () => {
  it('applies critical limits to admin governance mutation endpoints', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/admin/governance/weights',
      'PATCH',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_ADMIN_CRITICAL_MAX,
      timeWindow: config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS,
    });
  });

  it('applies critical limits to governance transition endpoint', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/governance/epochs/transition',
      'POST',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_ADMIN_CRITICAL_MAX,
      timeWindow: config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS,
    });
  });

  it('does not attach special policy to governance read-only endpoint', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/governance/weights',
      'GET',
      noopKeyGenerator
    );

    expect(policy).toBeNull();
  });

  it('leaves shadow demo routes to the isolated demo Redis limiter', () => {
    const demoRoutes: Array<[string, string]> = [
      ['/api/demo/sessions', 'POST'],
      ['/api/demo/sessions/session-1', 'GET'],
      ['/api/demo/sessions/session-1/votes', 'POST'],
      ['/api/demo/sessions/session-1/agents/run', 'POST'],
      ['/api/demo/sessions/session-1/epochs/advance', 'POST'],
      ['/api/demo/sessions/session-1/feed', 'GET'],
      ['/api/demo/sessions/session-1/receipts', 'GET'],
    ];
    for (const [url, method] of demoRoutes) {
      expect(buildRouteRateLimitConfig(url, method, noopKeyGenerator)).toBeNull();
    }
  });

  it('applies critical limits to MCP transport endpoint', () => {
    const policy = buildRouteRateLimitConfig(
      '/mcp',
      'POST',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_ADMIN_CRITICAL_MAX,
      timeWindow: config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS,
    });
  });

  // Guards the ordering the rate-limit-config comment calls out: the public
  // waitlist POST must match its own IP-keyed login-tier branch, NOT fall
  // through to the generic governance-mutation branch (which would DID-key it
  // and apply vote limits). A future reorder that breaks this fails here.
  it('rate-limits the public waitlist POST at the login tier with default IP keying', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/governance/waitlist',
      'POST',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_LOGIN_MAX,
      timeWindow: config.RATE_LIMIT_LOGIN_WINDOW_MS,
    });
    // No custom keyGenerator → inherits the plugin default (request.ip), so an
    // unauthenticated caller is never keyed by a (nonexistent) DID.
    expect(policy).not.toHaveProperty('keyGenerator');
  });
});

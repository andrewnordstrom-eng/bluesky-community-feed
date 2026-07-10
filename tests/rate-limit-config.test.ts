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

  it('applies vote-like limits to shadow demo mutation endpoints', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/demo/sessions/session-1/votes',
      'POST',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_VOTE_MAX,
      timeWindow: config.RATE_LIMIT_VOTE_WINDOW_MS,
      keyGenerator: noopKeyGenerator,
    });
  });

  it('applies login-like limits to shadow demo session creation', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/demo/sessions',
      'POST',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_LOGIN_MAX,
      timeWindow: config.RATE_LIMIT_LOGIN_WINDOW_MS,
      keyGenerator: noopKeyGenerator,
    });
  });

  it('applies bounded read limits to shadow demo read endpoints', () => {
    const policy = buildRouteRateLimitConfig(
      '/api/demo/sessions/session-1/feed',
      'GET',
      noopKeyGenerator
    );

    expect(policy).toMatchObject({
      max: config.RATE_LIMIT_INTERACTIONS_MAX,
      timeWindow: config.RATE_LIMIT_INTERACTIONS_WINDOW_MS,
    });
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
});

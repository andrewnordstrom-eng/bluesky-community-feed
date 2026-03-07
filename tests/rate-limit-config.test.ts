import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { config } from '../src/config.js';
import { buildRouteRateLimitConfig } from '../src/feed/server.js';

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

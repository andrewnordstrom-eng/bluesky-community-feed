import type { FastifyInstance } from 'fastify';
import { getHealthStatus } from '../../lib/health.js';
import { adminSecurity } from '../../lib/openapi.js';

const componentHealthSchema = {
  type: 'object' as const,
  properties: {
    status: { type: 'string' as const, enum: ['healthy', 'unhealthy'] },
    latency_ms: { type: 'number' as const, description: 'Check latency in milliseconds' },
    error: { type: 'string' as const, description: 'Error message if unhealthy' },
  },
  required: ['status' as const],
};

/**
 * Register admin health check routes.
 */
export function registerAdminHealthRoutes(app: FastifyInstance): void {
  app.get('/health', {
    schema: {
      tags: ['Admin'],
      summary: 'Deep health check',
      description: 'Returns detailed health status for all system components (database, Redis, Jetstream, scoring). Requires admin access.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'], description: 'Overall system health' },
            timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp of the health check' },
            components: {
              type: 'object',
              properties: {
                database: componentHealthSchema,
                redis: componentHealthSchema,
                jetstream: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                    connected: { type: 'boolean', description: 'Whether the WebSocket is connected' },
                    last_event_age_ms: { type: 'number', description: 'Age of the last received event in ms' },
                    error: { type: 'string' },
                  },
                  required: ['status', 'connected'],
                },
                scoring: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                    is_running: { type: 'boolean', description: 'Whether a scoring run is in progress' },
                    last_run_at: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp of last scoring run' },
                    error: { type: 'string' },
                  },
                  required: ['status', 'is_running'],
                },
              },
            },
          },
          required: ['status', 'timestamp', 'components'],
        },
      },
    },
  }, async () => {
    return getHealthStatus();
  });
}

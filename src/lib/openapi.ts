/**
 * OpenAPI schema helpers for Fastify route documentation.
 *
 * Provides utilities to convert Zod schemas to JSON Schema (OpenAPI 3.0)
 * and reusable response schema fragments used across all route files.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

/**
 * Convert a Zod schema to JSON Schema for Fastify route decoration.
 * Uses openApi3 target for compatibility with @fastify/swagger.
 */
export function zodToOpenApi<T extends z.ZodType>(schema: T) {
  return zodToJsonSchema(schema, { target: 'openApi3' });
}

/**
 * Standard error response schema (reusable across all routes).
 * Matches the AppError shape from src/lib/errors.ts.
 */
export const ErrorResponseSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const, description: 'Error code (e.g. "ValidationError", "NotFound")' },
    message: { type: 'string' as const, description: 'Human-readable error message' },
    correlationId: { type: 'string' as const, description: 'Request correlation ID for debugging' },
  },
  required: ['error', 'message'] as const,
};

/**
 * Rate-limited error response schema.
 * Returned by mutation endpoints when rate limit is exceeded.
 */
export const RateLimitResponseSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const, example: 'TooManyRequests' },
    message: { type: 'string' as const },
    retryAfterSeconds: { type: 'integer' as const, description: 'Seconds to wait before retrying' },
    correlationId: { type: 'string' as const },
  },
  required: ['error', 'message'] as const,
};

/**
 * Security requirement for governance endpoints (cookie or bearer auth).
 */
export const governanceSecurity: { [key: string]: string[] }[] = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];

/**
 * Security requirement for admin endpoints.
 */
export const adminSecurity: { [key: string]: string[] }[] = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];

/**
 * OpenAPI schema helpers for Fastify route documentation.
 *
 * Provides utilities to convert Zod schemas to JSON Schema (OpenAPI 3.0)
 * and reusable response schema fragments used across all route files.
 */

import { zodToJsonSchema as zodSchemaToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

/**
 * Convert a Zod schema to JSON Schema for Fastify/Ajv route validation.
 *
 * `zod-to-json-schema` (3.25.x) supports Zod 4 at runtime, but its published
 * types still model Zod 3's `ZodType` and reject Zod 4 schemas at compile
 * time. This wrapper bridges the schema type at a single boundary so every
 * route converts through one import — a future zod / zod-to-json-schema bump
 * then touches this one file instead of every route that decorates a schema.
 */
export function zodToJsonSchema(
  schema: z.ZodType,
  options?: Parameters<typeof zodSchemaToJsonSchema>[1],
) {
  // Zod 4's ZodType and zod-to-json-schema's (Zod 3-modelled) ZodType do not
  // structurally overlap, so bridge through `unknown` — the call is runtime-safe.
  return zodSchemaToJsonSchema(
    schema as unknown as Parameters<typeof zodSchemaToJsonSchema>[0],
    options,
  );
}

/**
 * Convert a Zod schema to JSON Schema for Fastify route decoration.
 * Uses jsonSchema7 target for Ajv compatibility (Fastify 5 compiles
 * querystring/body schemas with Ajv Draft 7). The $schema property
 * is stripped to avoid confusing Fastify's internal schema handling.
 */
export function zodToOpenApi<T extends z.ZodType>(schema: T) {
  const result = zodToJsonSchema(schema, { target: 'jsonSchema7' });

  if (typeof result === 'object' && result !== null && '$schema' in result) {
    const { $schema: _, ...rest } = result;
    return rest;
  }

  return result;
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

import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { registerDescribeGenerator } from './routes/describe-generator.js';
import { registerWellKnown } from './routes/well-known.js';
import { registerFeedSkeleton } from './routes/feed-skeleton.js';
import { registerSendInteractions } from './routes/send-interactions.js';
import { registerGovernanceRoutes } from '../governance/server.js';
import { registerTransparencyRoutes } from '../transparency/server.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerAdminRoutes } from '../admin/routes/index.js';
import { registerLegalRoutes } from '../legal/server.js';
import { getPublicHealthStatus, isLive, isReady } from '../lib/health.js';
import { generateCorrelationId } from '../lib/correlation.js';
import { AppError, isAppError } from '../lib/errors.js';
import { redis } from '../db/redis.js';
import { getAuthenticatedDid } from '../governance/auth.js';

// Extend FastifyRequest to include correlationId
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

/**
 * Create and configure the Fastify server instance.
 * Registers all feed-related routes.
 */
export async function createServer() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: parseTrustProxyConfig(config.TRUST_PROXY),
  });

  const allowedOrigins = parseAllowedOrigins();

  // Register CORS for cross-origin requests
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }

      cb(null, allowedOrigins.has(origin));
    },
  });

  // Security headers for browser-facing endpoints
  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:', 'wss:'],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
  });

  // No-op validator: route schemas are for OpenAPI documentation only.
  // Actual request validation is handled by Zod safeParse() in each handler.
  app.setValidatorCompiler(() => () => true);

  // OpenAPI documentation via Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Community Feed API',
        description: 'Community-governed Bluesky feed generator API',
        version: '1.0.0',
      },
      servers: [{ url: `https://${config.FEEDGEN_HOSTNAME}` }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  if (config.RATE_LIMIT_ENABLED) {
    const governanceMutationKeyGenerator = async (request: FastifyRequest) => {
      try {
        const did = await getAuthenticatedDid(request);
        return did ?? request.ip;
      } catch {
        return request.ip;
      }
    };

    app.addHook('onRoute', (routeOptions) => {
      const rateLimitConfig = buildRouteRateLimitConfig(
        routeOptions.url,
        routeOptions.method,
        governanceMutationKeyGenerator
      );

      if (!rateLimitConfig) {
        return;
      }

      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: rateLimitConfig,
      };
    });

    await app.register(fastifyRateLimit, {
      global: true,
      redis,
      max: config.RATE_LIMIT_GLOBAL_MAX,
      timeWindow: config.RATE_LIMIT_GLOBAL_WINDOW_MS,
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: (_request, context) => ({
        statusCode: 429,
        error: 'TooManyRequests',
        message: 'Rate limit exceeded. Please retry later.',
        retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
      }),
    });
  }

  // Add correlation ID to every request
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    const incomingId = request.headers['x-correlation-id'];
    const correlationId = typeof incomingId === 'string' ? incomingId : generateCorrelationId();
    request.correlationId = correlationId;
    reply.header('x-correlation-id', correlationId);
    done();
  });

  // Log all requests with correlation ID
  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    logger.info({
      correlationId: request.correlationId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, 'Request completed');
    done();
  });

  // Register feed generator routes (required by Bluesky)
  registerDescribeGenerator(app);
  registerWellKnown(app);
  registerFeedSkeleton(app);
  registerSendInteractions(app);

  // Register governance routes
  registerGovernanceRoutes(app);

  // Register transparency routes
  registerTransparencyRoutes(app);

  // Register debug routes
  registerDebugRoutes(app);

  // Register admin routes
  registerAdminRoutes(app);

  // Register legal document routes
  registerLegalRoutes(app);

  // Public health check endpoint - redacted status only
  app.get('/health', async () => {
    return getPublicHealthStatus();
  });

  // Liveness probe - just checks if process is running (k8s liveness)
  app.get('/health/live', async (_request, reply) => {
    if (isLive()) {
      return reply.status(200).send({ status: 'live' });
    }
    return reply.status(503).send({ status: 'not live' });
  });

  // Readiness probe - checks if all dependencies are healthy (k8s readiness)
  app.get('/health/ready', async (_request, reply) => {
    const ready = await isReady();
    if (ready) {
      return reply.status(200).send({ status: 'ready' });
    }
    return reply.status(503).send({ status: 'not ready' });
  });

  // OpenAPI JSON endpoint
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => {
    return app.swagger();
  });

  // Standardized error handler with correlation ID
  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = request.correlationId || 'unknown';
    const rateLimitError = error as Partial<{
      statusCode: number;
      code: number | string;
      error: string;
      message: string;
      retryAfterSeconds: number;
    }>;

    if (
      rateLimitError.statusCode === 429 ||
      rateLimitError.code === 429 ||
      rateLimitError.error === 'TooManyRequests'
    ) {
      const response: Record<string, unknown> = {
        error: 'TooManyRequests',
        message: rateLimitError.message ?? 'Rate limit exceeded. Please retry later.',
        correlationId,
      };
      if (typeof rateLimitError.retryAfterSeconds === 'number') {
        response.retryAfterSeconds = rateLimitError.retryAfterSeconds;
      }

      logger.warn({
        correlationId,
        retryAfterSeconds: rateLimitError.retryAfterSeconds,
      }, 'Rate limit exceeded');

      return reply.status(429).send(response);
    }

    // Handle AppError (our custom error type)
    if (isAppError(error)) {
      logger.warn({
        err: error,
        correlationId,
        errorCode: error.errorCode,
      }, error.message);

      return reply.status(error.statusCode).send(error.toResponse(correlationId));
    }

    // Handle Fastify validation errors
    const fastifyError = error as Error & { validation?: unknown };
    if (fastifyError.validation) {
      logger.warn({
        err: error,
        correlationId,
        validation: fastifyError.validation,
      }, 'Validation error');

      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        correlationId,
        details: fastifyError.validation,
      });
    }

    // Handle unexpected errors
    logger.error({
      err: error,
      correlationId,
      stack: error.stack,
    }, 'Unexpected error');

    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  });

  // Serve frontend static files (must be AFTER all API routes)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDistPath = path.join(__dirname, '../../web/dist');

  // Only register static serving if web/dist exists (production with built frontend)
  if (fs.existsSync(webDistPath)) {
    logger.info({ webDistPath }, 'Registering static file serving for frontend');

    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false, // Don't match all routes, let API routes take precedence
    });

    // SPA fallback - serve index.html for frontend routes
    app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      // Only serve index.html for GET requests to non-API routes
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/xrpc/') &&
        !request.url.startsWith('/.well-known/') &&
        !request.url.startsWith('/health')
      ) {
        return reply.sendFile('index.html');
      }
      // For API 404s, return JSON error
      return reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404,
      });
    });
  }

  return app;
}

interface RouteRateLimitConfig {
  max: number;
  timeWindow: number;
  keyGenerator?: (request: FastifyRequest) => string | Promise<string>;
}

function normalizeRouteMethods(method: string | string[]): string[] {
  if (Array.isArray(method)) {
    return method.map((value) => value.toUpperCase());
  }
  return [method.toUpperCase()];
}

export function buildRouteRateLimitConfig(
  url: string,
  method: string | string[],
  governanceMutationKeyGenerator: (request: FastifyRequest) => string | Promise<string>
): RouteRateLimitConfig | null {
  const methods = normalizeRouteMethods(method);
  const isReadOnly = methods.every((value) => value === 'GET' || value === 'HEAD' || value === 'OPTIONS');

  // Tight rate limit on sendInteractions due to cold-cache DID resolution cost
  if (url === '/xrpc/app.bsky.feed.sendInteractions') {
    return {
      max: config.RATE_LIMIT_INTERACTIONS_MAX,
      timeWindow: config.RATE_LIMIT_INTERACTIONS_WINDOW_MS,
    };
  }

  if (url.startsWith('/api/governance/auth/login')) {
    return {
      max: config.RATE_LIMIT_LOGIN_MAX,
      timeWindow: config.RATE_LIMIT_LOGIN_WINDOW_MS,
    };
  }

  if (url.startsWith('/api/governance/vote')) {
    return {
      max: config.RATE_LIMIT_VOTE_MAX,
      timeWindow: config.RATE_LIMIT_VOTE_WINDOW_MS,
      keyGenerator: governanceMutationKeyGenerator,
    };
  }

  if (url.startsWith('/api/governance/') && !isReadOnly) {
    const isCriticalGovernanceMutation =
      url === '/api/governance/epochs/transition' ||
      url === '/api/governance/auth/logout';
    return {
      max: isCriticalGovernanceMutation
        ? config.RATE_LIMIT_ADMIN_CRITICAL_MAX
        : config.RATE_LIMIT_VOTE_MAX,
      timeWindow: isCriticalGovernanceMutation
        ? config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS
        : config.RATE_LIMIT_VOTE_WINDOW_MS,
      keyGenerator: governanceMutationKeyGenerator,
    };
  }

  if (url.startsWith('/api/admin/')) {
    const isCriticalAdminAction =
      url === '/api/admin/epochs/transition' ||
      url === '/api/admin/feed/rescore' ||
      url === '/api/admin/scheduler/check' ||
      (url.startsWith('/api/admin/governance/') && !isReadOnly);
    return {
      max: isCriticalAdminAction
        ? config.RATE_LIMIT_ADMIN_CRITICAL_MAX
        : config.RATE_LIMIT_ADMIN_MAX,
      timeWindow: isCriticalAdminAction
        ? config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS
        : config.RATE_LIMIT_ADMIN_WINDOW_MS,
    };
  }

  if (
    url === '/api/bot/announce' ||
    url === '/api/bot/retry' ||
    url === '/api/bot/unpin'
  ) {
    return {
      max: config.RATE_LIMIT_ADMIN_CRITICAL_MAX,
      timeWindow: config.RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS,
    };
  }

  return null;
}

function parseAllowedOrigins(): Set<string> {
  const configured = config.CORS_ALLOWED_ORIGINS
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return new Set(configured);
  }

  const defaults =
    config.NODE_ENV === 'production'
      ? [`https://${config.FEEDGEN_HOSTNAME}`]
      : [
          `https://${config.FEEDGEN_HOSTNAME}`,
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://localhost:3000',
          'http://127.0.0.1:3000',
        ];

  return new Set(defaults);
}

export function parseTrustProxyConfig(value: string): boolean | number | string | string[] {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (lower === 'true' || lower === 'on') {
    return true;
  }

  if (lower === 'false' || lower === 'off') {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  if (normalized.includes(',')) {
    return normalized
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return normalized;
}

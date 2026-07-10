import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import {
  SHADOW_DEMO_COMMUNITY_IDS,
  SHADOW_DEMO_CONTRACT_VERSION,
  type ShadowDemoEnvelope,
} from './types.js';
import {
  DemoConflictError,
  DemoNotFoundError,
  DemoValidationError,
  ShadowDemoService,
  createDefaultShadowDemoService,
} from './service.js';

const IdempotencyKeySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/);

const WeightSchema = z.object({
  recency: z.number().min(0).finite(),
  engagement: z.number().min(0).finite(),
  bridging: z.number().min(0).finite(),
  source_diversity: z.number().min(0).finite(),
  relevance: z.number().min(0).finite(),
}).strict();

const TopicIntentSchema = z.object({
  topicWeights: z.record(z.number().min(0).max(1)),
}).strict();

const CreateSessionBodySchema = z.object({
  communityId: z.enum(SHADOW_DEMO_COMMUNITY_IDS).optional(),
  refreshCorpus: z.boolean().optional(),
}).strict();

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(128),
}).strict();

const VoteBodySchema = z.object({
  baseEpochId: z.string().min(1).max(64),
  weights: WeightSchema,
  topicIntent: TopicIntentSchema,
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict();

const SyntheticVotersBodySchema = z.object({
  baseEpochId: z.string().min(1).max(64),
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict();

const AdvanceBodySchema = z.object({
  fromEpochId: z.string().min(1).max(64),
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict();

const FeedQuerySchema = z.object({
  epochId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const ReceiptQuerySchema = z.object({
  epochId: z.string().min(1).max(64).optional(),
  postUri: z.string().min(1).max(512),
}).strict();

export function registerShadowDemoRoutes(
  app: FastifyInstance,
  serviceOverride: ShadowDemoService | null
): void {
  const service = serviceOverride ?? createDefaultShadowDemoService();

  app.post('/api/demo/sessions', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const body = parseOrThrow(CreateSessionBodySchema, request.body ?? {});
      return service.createSession({
        communityId: body.communityId ?? 'open_science_builders',
        refreshCorpus: body.refreshCorpus ?? false,
      });
    });
  });

  app.get('/api/demo/sessions/:sessionId', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      return service.getSession(params.sessionId);
    });
  });

  app.post('/api/demo/sessions/:sessionId/votes', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      const body = parseOrThrow(VoteBodySchema, request.body ?? {});
      return service.castVote({
        sessionId: params.sessionId,
        baseEpochId: body.baseEpochId,
        weights: body.weights,
        topicIntent: body.topicIntent,
        idempotencyKey: idempotencyKeyFrom(request, body.idempotencyKey ?? null),
      });
    });
  });

  app.post('/api/demo/sessions/:sessionId/agents/run', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      const body = parseOrThrow(SyntheticVotersBodySchema, request.body ?? {});
      return service.runSyntheticVoters({
        sessionId: params.sessionId,
        baseEpochId: body.baseEpochId,
        idempotencyKey: idempotencyKeyFrom(request, body.idempotencyKey ?? null),
      });
    });
  });

  app.post('/api/demo/sessions/:sessionId/epochs/advance', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      const body = parseOrThrow(AdvanceBodySchema, request.body ?? {});
      return service.advanceEpoch({
        sessionId: params.sessionId,
        fromEpochId: body.fromEpochId,
        idempotencyKey: idempotencyKeyFrom(request, body.idempotencyKey ?? null),
      });
    });
  });

  app.get('/api/demo/sessions/:sessionId/feed', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      const query = parseOrThrow(FeedQuerySchema, request.query);
      const limit = query.limit ?? 25;
      return service.getFeed({
        sessionId: params.sessionId,
        epochId: query.epochId ?? null,
        limit,
      });
    });
  });

  app.get('/api/demo/sessions/:sessionId/receipts', { schema: { tags: ['Demo'] } }, async (request, reply) => {
    return handleShadowDemoRequest(request, reply, async () => {
      const params = parseOrThrow(SessionParamsSchema, request.params);
      const query = parseOrThrow(ReceiptQuerySchema, request.query);
      return service.getReceipt({
        sessionId: params.sessionId,
        epochId: query.epochId ?? null,
        postUri: query.postUri,
      });
    });
  });
}

function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DemoValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

function idempotencyKeyFrom(request: FastifyRequest, bodyKey: string | null): string | null {
  if (bodyKey) {
    return bodyKey;
  }
  const header = request.headers['idempotency-key'];
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }
  const parsed = IdempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw new DemoValidationError('idempotency-key header is malformed');
  }
  return parsed.data;
}

function sendEnvelope<TPayload>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: {
    sessionId: string | null;
    payload: TPayload;
    warnings: ShadowDemoEnvelope<TPayload>['warnings'];
  }
): FastifyReply {
  const envelope: ShadowDemoEnvelope<TPayload> = {
    contractVersion: SHADOW_DEMO_CONTRACT_VERSION,
    requestId: request.correlationId ?? randomUUID(),
    generatedAt: new Date().toISOString(),
    sessionId: result.sessionId,
    payload: result.payload,
    warnings: result.warnings,
  };
  return reply.send(envelope);
}

async function handleShadowDemoRequest<TPayload>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<{
    sessionId: string | null;
    payload: TPayload;
    warnings: ShadowDemoEnvelope<TPayload>['warnings'];
  }>
): Promise<FastifyReply> {
  try {
    const result = await operation();
    return sendEnvelope(request, reply, result);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const correlationId = request.correlationId ?? randomUUID();
    const status = shadowDemoErrorStatus(error);
    if (status >= 500) {
      logger.error({ err: error, correlationId }, 'Unexpected shadow demo request failure');
    }
    return reply.code(status).send(shadowDemoErrorBody(error, correlationId));
  }
}

export function shadowDemoErrorStatus(error: Error): number {
  if (error instanceof DemoValidationError) {
    return 400;
  }
  if (error instanceof DemoNotFoundError) {
    return 404;
  }
  if (error instanceof DemoConflictError) {
    return 409;
  }
  return 500;
}

export function shadowDemoErrorBody(error: Error, correlationId: string): {
  error: string;
  message: string;
  correlationId: string;
} {
  if (
    error instanceof DemoValidationError ||
    error instanceof DemoNotFoundError ||
    error instanceof DemoConflictError
  ) {
    return {
      error: error.name,
      message: error.message,
      correlationId,
    };
  }
  return {
    error: 'DemoInternalError',
    message: 'Shadow demo request failed. Please retry the guided demo.',
    correlationId,
  };
}

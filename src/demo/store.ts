import { Redis } from 'ioredis';
import { z, type ZodTypeAny } from 'zod';
import { logger } from '../lib/logger.js';
import {
  SHADOW_DEMO_COMMUNITY_IDS,
  SHADOW_DEMO_PHASES,
  SHADOW_DEMO_SIGNAL_KEYS,
  SHADOW_DEMO_VOTER_BLOC_IDS,
  type ShadowDemoCommunityId,
  type ShadowDemoCorpus,
  type ShadowDemoSessionState,
} from './types.js';

const StoredWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['info', 'warning', 'degraded']),
});

const StoredWeightsSchema = z.object(
  Object.fromEntries(SHADOW_DEMO_SIGNAL_KEYS.map((key) => [key, z.number().finite()])) as Record<
    (typeof SHADOW_DEMO_SIGNAL_KEYS)[number],
    z.ZodNumber
  >
);

const StoredTopicIntentSchema = z.object({
  topicWeights: z.record(z.number().finite()),
});

const StoredDisplayPostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('public_post'),
    uri: z.string().min(1),
    cid: z.string().min(1),
    authorDid: z.string().min(1),
    authorHandle: z.string().min(1),
    authorDisplayName: z.string().min(1),
    authorAvatar: z.string().nullable(),
    text: z.string().min(1),
    likeCount: z.number().int().nonnegative(),
    repostCount: z.number().int().nonnegative(),
    replyCount: z.number().int().nonnegative(),
    quoteCount: z.number().int().nonnegative(),
    indexedAt: z.string().min(1),
    createdAt: z.string().min(1),
    bskyUrl: z.string().url(),
  }),
  z.object({
    kind: z.literal('hidden_post'),
    reason: z.string().min(1),
  }),
]);

const StoredCorpusItemSchema = z.object({
  postUri: z.string().min(1),
  authorDid: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  topicVector: z.record(z.number().finite()),
  rawScores: StoredWeightsSchema,
  productionScore: z.number().finite(),
  productionEpochId: z.number().int(),
  scoredAt: z.string().min(1),
  componentDetails: z.record(z.unknown()).nullable(),
  displayPost: StoredDisplayPostSchema,
});

const StoredCorpusHealthSchema = z.object({
  status: z.enum(['live', 'degraded']),
  source: z.enum(['production_scores_appview', 'fixture_fallback']),
  candidatePosts72h: z.number().int().nonnegative(),
  publicScoredPosts: z.number().int().nonnegative(),
  uniqueAuthors72h: z.number().int().nonnegative(),
  bridgePostShare: z.number().finite().nonnegative(),
  topAuthorConcentration: z.number().finite().nonnegative(),
  sampledAt: z.string().min(1),
});

const StoredCorpusSchema = z.object({
  corpusId: z.string().min(1),
  communityId: z.enum(SHADOW_DEMO_COMMUNITY_IDS),
  baseProductionEpochId: z.number().int(),
  baseWeights: StoredWeightsSchema,
  baseTopicIntent: StoredTopicIntentSchema,
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  items: z.array(StoredCorpusItemSchema),
  health: StoredCorpusHealthSchema,
  warnings: z.array(StoredWarningSchema),
});

const StoredVoteSummarySchema = z.object({
  aggregateMethod: z.literal('trimmed_mean_no_trim_under_10'),
  voteCount: z.number().int().nonnegative(),
  trimCount: z.number().int().nonnegative(),
  weights: StoredWeightsSchema,
  topicIntent: StoredTopicIntentSchema,
});

const StoredEpochSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  label: z.string().min(1),
  status: z.enum(['open', 'advanced']),
  createdAt: z.string().min(1),
  advancedAt: z.string().min(1).nullable(),
  decidedByEpochId: z.string().min(1).nullable(),
  aggregate: StoredVoteSummarySchema,
});

const StoredVoteBaseSchema = z.object({
  id: z.string().min(1),
  epochId: z.string().min(1),
  label: z.string().min(1),
  weights: StoredWeightsSchema,
  topicIntent: StoredTopicIntentSchema,
  createdAt: z.string().min(1),
});

const StoredVoteSchema = z.discriminatedUnion('actorType', [
  StoredVoteBaseSchema.extend({
    actorType: z.literal('reviewer'),
    actorId: z.literal('reviewer'),
  }),
  StoredVoteBaseSchema.extend({
    actorType: z.literal('synthetic_voter'),
    actorId: z.string().regex(/^synthetic-[a-z_]+-\d+$/),
    blocId: z.enum(SHADOW_DEMO_VOTER_BLOC_IDS),
  }),
]);

const StoredSessionHeaderSchema = z.object({
  sessionId: z.string().min(1),
  communityId: z.enum(SHADOW_DEMO_COMMUNITY_IDS),
  seed: z.string().min(1),
  phase: z.enum(SHADOW_DEMO_PHASES),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  corpusId: z.string().min(1),
  currentEpochId: z.string().min(1),
  epochs: z.array(StoredEpochSchema),
  votes: z.array(StoredVoteSchema),
  warnings: z.array(StoredWarningSchema),
});

const StoredIdempotencySchema = z.object({
  requestHash: z.string().min(1),
  response: z.unknown(),
  createdAt: z.string().min(1),
}).passthrough();

export class DemoStoreCorruptionError extends Error {
  constructor(key: string, detail: string) {
    super(`Invalid shadow demo Redis record at ${key}: ${detail}`);
    this.name = 'DemoStoreCorruptionError';
  }
}

export interface IdempotencyRecord<TPayload> {
  requestHash: string;
  response: TPayload;
  createdAt: string;
}

export interface DemoStore {
  readSession(sessionId: string): Promise<ShadowDemoSessionState | null>;
  writeSession(session: ShadowDemoSessionState, ttlSeconds: number): Promise<void>;
  readIdempotency<TPayload>(sessionId: string, key: string): Promise<IdempotencyRecord<TPayload> | null>;
  writeIdempotency<TPayload>(
    sessionId: string,
    key: string,
    record: IdempotencyRecord<TPayload>,
    ttlSeconds: number
  ): Promise<void>;
  readSharedCorpus(communityId: ShadowDemoCommunityId): Promise<ShadowDemoCorpus | null>;
  writeSharedCorpus(communityId: ShadowDemoCommunityId, corpus: ShadowDemoCorpus, ttlSeconds: number): Promise<void>;
  acquireCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string, ttlMs: number): Promise<boolean>;
  renewCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string, ttlMs: number): Promise<boolean>;
  releaseCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string): Promise<void>;
  acquireSessionLock(sessionId: string, token: string, ttlMs: number): Promise<boolean>;
  releaseSessionLock(sessionId: string, token: string): Promise<void>;
}

export class RedisDemoStore implements DemoStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async readSession(sessionId: string): Promise<ShadowDemoSessionState | null> {
    const key = sessionKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    const header = parseStoredRecord<Omit<ShadowDemoSessionState, 'corpus'>>(
      StoredSessionHeaderSchema,
      raw,
      key
    );
    const storedCorpusKey = corpusKey(header.corpusId);
    const rawCorpus = await this.redis.get(storedCorpusKey);
    if (!rawCorpus) {
      throw new DemoStoreCorruptionError(
        key,
        `referenced corpus ${header.corpusId} is missing at ${storedCorpusKey}`
      );
    }
    const corpus = parseStoredRecord<ShadowDemoCorpus>(StoredCorpusSchema, rawCorpus, storedCorpusKey);
    return { ...header, corpus };
  }

  async writeSession(session: ShadowDemoSessionState, ttlSeconds: number): Promise<void> {
    const storedCorpusKey = corpusKey(session.corpusId);
    const corpusExists = await this.redis.exists(storedCorpusKey);
    if (corpusExists === 0) {
      await this.redis.setex(storedCorpusKey, ttlSeconds, JSON.stringify(session.corpus));
    } else {
      const refreshed = await this.redis.expire(storedCorpusKey, ttlSeconds);
      if (refreshed === 0) {
        await this.redis.setex(storedCorpusKey, ttlSeconds, JSON.stringify(session.corpus));
      }
    }
    const { corpus: _corpus, ...sessionHeader } = session;
    await this.redis.setex(sessionKey(session.sessionId), ttlSeconds, JSON.stringify(sessionHeader));
  }

  async readIdempotency<TPayload>(sessionId: string, key: string): Promise<IdempotencyRecord<TPayload> | null> {
    const redisKey = idempotencyKey(sessionId, key);
    const raw = await this.redis.get(redisKey);
    return raw
      ? parseStoredRecord<IdempotencyRecord<TPayload>>(StoredIdempotencySchema, raw, redisKey)
      : null;
  }

  async writeIdempotency<TPayload>(
    sessionId: string,
    key: string,
    record: IdempotencyRecord<TPayload>,
    ttlSeconds: number
  ): Promise<void> {
    await this.redis.setex(idempotencyKey(sessionId, key), ttlSeconds, JSON.stringify(record));
  }

  async readSharedCorpus(communityId: ShadowDemoCommunityId): Promise<ShadowDemoCorpus | null> {
    const key = sharedCorpusKey(communityId);
    const raw = await this.redis.get(key);
    return raw ? parseStoredRecord<ShadowDemoCorpus>(StoredCorpusSchema, raw, key) : null;
  }

  async writeSharedCorpus(
    communityId: ShadowDemoCommunityId,
    corpus: ShadowDemoCorpus,
    ttlSeconds: number
  ): Promise<void> {
    await this.redis.setex(sharedCorpusKey(communityId), ttlSeconds, JSON.stringify(corpus));
  }

  async acquireCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(corpusBuildLockKey(communityId), token, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async renewCorpusBuildLock(
    communityId: ShadowDemoCommunityId,
    token: string,
    ttlMs: number
  ): Promise<boolean> {
    const renewed = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      corpusBuildLockKey(communityId),
      token,
      ttlMs
    );
    return renewed === 1;
  }

  async releaseCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      corpusBuildLockKey(communityId),
      token
    );
  }

  async acquireSessionLock(sessionId: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(lockKey(sessionId), token, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseSessionLock(sessionId: string, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey(sessionId),
      token
    );
  }
}

export class MemoryDemoStore implements DemoStore {
  private readonly sessions = new Map<string, ShadowDemoSessionState>();
  private readonly idempotency = new Map<string, IdempotencyRecord<unknown>>();
  private readonly sharedCorpus = new Map<ShadowDemoCommunityId, ShadowDemoCorpus>();
  private readonly locks = new Map<string, string>();

  async readSession(sessionId: string): Promise<ShadowDemoSessionState | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async writeSession(session: ShadowDemoSessionState, _ttlSeconds: number): Promise<void> {
    this.sessions.set(session.sessionId, JSON.parse(JSON.stringify(session)) as ShadowDemoSessionState);
  }

  async readIdempotency<TPayload>(sessionId: string, key: string): Promise<IdempotencyRecord<TPayload> | null> {
    return (this.idempotency.get(idempotencyKey(sessionId, key)) as IdempotencyRecord<TPayload> | undefined) ?? null;
  }

  async writeIdempotency<TPayload>(
    sessionId: string,
    key: string,
    record: IdempotencyRecord<TPayload>,
    _ttlSeconds: number
  ): Promise<void> {
    this.idempotency.set(idempotencyKey(sessionId, key), record as IdempotencyRecord<unknown>);
  }

  async readSharedCorpus(communityId: ShadowDemoCommunityId): Promise<ShadowDemoCorpus | null> {
    return this.sharedCorpus.get(communityId) ?? null;
  }

  async writeSharedCorpus(
    communityId: ShadowDemoCommunityId,
    corpus: ShadowDemoCorpus,
    _ttlSeconds: number
  ): Promise<void> {
    this.sharedCorpus.set(communityId, JSON.parse(JSON.stringify(corpus)) as ShadowDemoCorpus);
  }

  async acquireCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string, _ttlMs: number): Promise<boolean> {
    const key = corpusBuildLockKey(communityId);
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, token);
    return true;
  }

  async renewCorpusBuildLock(
    communityId: ShadowDemoCommunityId,
    token: string,
    _ttlMs: number
  ): Promise<boolean> {
    return this.locks.get(corpusBuildLockKey(communityId)) === token;
  }

  async releaseCorpusBuildLock(communityId: ShadowDemoCommunityId, token: string): Promise<void> {
    const key = corpusBuildLockKey(communityId);
    if (this.locks.get(key) === token) {
      this.locks.delete(key);
    }
  }

  async acquireSessionLock(sessionId: string, token: string, _ttlMs: number): Promise<boolean> {
    const key = lockKey(sessionId);
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, token);
    return true;
  }

  async releaseSessionLock(sessionId: string, token: string): Promise<void> {
    const key = lockKey(sessionId);
    if (this.locks.get(key) === token) {
      this.locks.delete(key);
    }
  }
}

export function createRedisDemoStore(): DemoStore {
  const redis = new Redis(redisUrlFromEnv(), {
    maxRetriesPerRequest: 3,
    commandTimeout: redisCommandTimeoutFromEnv(),
    retryStrategy(times: number) {
      return Math.min(times * 50, 2000);
    },
  });
  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Shadow demo Redis connection error');
  });
  return new RedisDemoStore(redis);
}

function parseStoredRecord<TRecord>(schema: ZodTypeAny, raw: string, key: string): TRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DemoStoreCorruptionError(key, `malformed JSON (${detail})`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DemoStoreCorruptionError(
      key,
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    );
  }
  return result.data as TRecord;
}

function redisUrlFromEnv(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !redisUrl.startsWith('redis://')) {
    throw new Error('Shadow demo Redis store requires REDIS_URL with redis:// scheme');
  }
  return redisUrl;
}

function redisCommandTimeoutFromEnv(): number {
  const raw = process.env.REDIS_COMMAND_TIMEOUT_MS;
  if (!raw) {
    return 5000;
  }
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
    throw new Error(`Shadow demo Redis store requires REDIS_COMMAND_TIMEOUT_MS >= 100; received ${raw}`);
  }
  return timeoutMs;
}

export function demoSessionKeyPrefix(): string {
  return 'demo:session:';
}

export function demoCorpusKeyPrefix(): string {
  return 'demo:corpus:';
}

export function demoIdempotencyKeyPrefix(): string {
  return 'demo:idempotency:';
}

export function demoLockKeyPrefix(): string {
  return 'demo:lock:';
}

export function demoSharedCorpusKeyPrefix(): string {
  return 'demo:corpus:current:';
}

function sessionKey(sessionId: string): string {
  return `${demoSessionKeyPrefix()}${sessionId}`;
}

function corpusKey(corpusId: string): string {
  return `${demoCorpusKeyPrefix()}${corpusId}`;
}

function sharedCorpusKey(communityId: ShadowDemoCommunityId): string {
  return `${demoSharedCorpusKeyPrefix()}${communityId}`;
}

function idempotencyKey(sessionId: string, key: string): string {
  return `${demoIdempotencyKeyPrefix()}${sessionId}:${key}`;
}

function lockKey(sessionId: string): string {
  return `${demoLockKeyPrefix()}${sessionId}`;
}

function corpusBuildLockKey(communityId: ShadowDemoCommunityId): string {
  return `${demoLockKeyPrefix()}corpus:${communityId}`;
}

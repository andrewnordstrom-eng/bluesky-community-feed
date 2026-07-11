import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';
import { logger } from '../lib/logger.js';
import { DemoStoreUnavailableError } from './store.js';

export type DemoRateLimitKind = 'session_create' | 'mutation' | 'read';

export interface DemoRateLimitPolicy {
  max: number;
  windowMs: number;
}

export type DemoRateLimitPolicies = Record<DemoRateLimitKind, DemoRateLimitPolicy>;

export interface DemoRateLimitGuard {
  check(kind: DemoRateLimitKind, identifier: string): Promise<void>;
  close(): Promise<void>;
}

export class DemoRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Shadow demo rate limit exceeded. Please retry later.');
    this.name = 'DemoRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RedisDemoRateLimitGuard implements DemoRateLimitGuard {
  private readonly redis: Redis;
  private readonly policies: DemoRateLimitPolicies;
  private readonly identifierHashSecret: string;
  private connectionPromise: Promise<void> | null = null;

  constructor(redis: Redis, policies: DemoRateLimitPolicies, identifierHashSecret: string) {
    this.redis = redis;
    this.policies = policies;
    this.identifierHashSecret = identifierHashSecret;
  }

  async check(kind: DemoRateLimitKind, identifier: string): Promise<void> {
    const policy = this.policies[kind];
    const key = `demo:rate-limit:${kind}:${hashIdentifier(identifier, this.identifierHashSecret)}`;
    let result: unknown;
    try {
      await this.connectIfNeeded();
      result = await this.redis.eval(
        `local current = redis.call('incr', KEYS[1])
         if current == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
         return {current, redis.call('pttl', KEYS[1])}`,
        1,
        key,
        policy.windowMs
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new DemoStoreUnavailableError('apply demo rate limit', detail);
    }
    if (!Array.isArray(result) || result.length !== 2) {
      throw new DemoStoreUnavailableError('apply demo rate limit', 'Redis returned an invalid counter result');
    }
    const current = Number(result[0]);
    const ttlMs = Number(result[1]);
    if (!Number.isInteger(current) || current < 1 || !Number.isFinite(ttlMs)) {
      throw new DemoStoreUnavailableError('apply demo rate limit', 'Redis returned invalid counter values');
    }
    if (current > policy.max) {
      throw new DemoRateLimitError(Math.max(1, Math.ceil(ttlMs / 1000)));
    }
  }

  async close(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      return;
    }
    this.redis.disconnect(false);
  }

  private async connectIfNeeded(): Promise<void> {
    if (this.connectionPromise) {
      await this.connectionPromise;
      return;
    }
    if (this.redis.status !== 'wait') {
      return;
    }
    this.connectionPromise = this.redis.connect().finally(() => {
      this.connectionPromise = null;
    });
    await this.connectionPromise;
  }
}

export function createRedisDemoRateLimitGuard(options: {
  redisUrl: string;
  commandTimeoutMs: number;
  policies: DemoRateLimitPolicies;
  identifierHashSecret: string;
}): DemoRateLimitGuard {
  const redis = new Redis(options.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: options.commandTimeoutMs,
    retryStrategy(times: number) {
      return Math.min(times * 50, 2000);
    },
  });
  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Shadow demo rate-limit Redis connection error');
  });
  return new RedisDemoRateLimitGuard(redis, options.policies, options.identifierHashSecret);
}

function hashIdentifier(identifier: string, secret: string): string {
  return createHmac('sha256', secret).update(identifier).digest('hex');
}

export function demoRateLimitKeyPrefix(): string {
  return 'demo:rate-limit:';
}

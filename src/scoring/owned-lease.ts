import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export interface LeaseRedisClient {
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX'
  ): Promise<'OK' | null>;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export class RedisLeaseUnavailableError extends Error {
  constructor(operation: 'acquire' | 'renew' | 'release', key: string, cause: unknown) {
    super(`Redis lease ${operation} failed for ${key}`, { cause });
    this.name = 'RedisLeaseUnavailableError';
  }
}

export class OwnedRedisLease {
  private readonly client: LeaseRedisClient;
  private readonly key: string;
  private readonly ttlMs: number;

  constructor(client: LeaseRedisClient, key: string, ttlMs: number) {
    if (!key.trim()) {
      throw new Error('Redis lease key must be non-empty');
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) {
      throw new Error(`Redis lease ttlMs must be an integer >= 1000, got ${ttlMs}`);
    }
    this.client = client;
    this.key = key;
    this.ttlMs = ttlMs;
  }

  createToken(): string {
    return randomUUID();
  }

  async acquire(token: string): Promise<boolean> {
    assertToken(token);
    try {
      return (await this.client.set(this.key, token, 'PX', this.ttlMs, 'NX')) === 'OK';
    } catch (error) {
      throw new RedisLeaseUnavailableError('acquire', this.key, error);
    }
  }

  async renew(token: string): Promise<boolean> {
    assertToken(token);
    try {
      const result = await this.client.eval(
        RENEW_SCRIPT,
        1,
        this.key,
        token,
        this.ttlMs
      );
      return Number(result) === 1;
    } catch (error) {
      throw new RedisLeaseUnavailableError('renew', this.key, error);
    }
  }

  async release(token: string): Promise<boolean> {
    assertToken(token);
    try {
      const result = await this.client.eval(RELEASE_SCRIPT, 1, this.key, token);
      return Number(result) === 1;
    } catch (error) {
      throw new RedisLeaseUnavailableError('release', this.key, error);
    }
  }
}

export function createOwnedScoringLease(client: Redis, ttlMs: number): OwnedRedisLease {
  return new OwnedRedisLease(client, 'lock:scoring', ttlMs);
}

function assertToken(token: string): void {
  if (!token.trim()) {
    throw new Error('Redis lease token must be non-empty');
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OwnedRedisLease,
  RedisLeaseUnavailableError,
  scoringLeaseKey,
  type LeaseRedisClient,
} from '../src/scoring/owned-lease.js';

describe('token-owned Redis scoring lease', () => {
  const set = vi.fn<LeaseRedisClient['set']>();
  const evalScript = vi.fn<LeaseRedisClient['eval']>();
  const client: LeaseRedisClient = { set, eval: evalScript };
  let lease: OwnedRedisLease;

  beforeEach(() => {
    vi.clearAllMocks();
    lease = new OwnedRedisLease(client, 'lock:scoring', 60_000);
  });

  it('acquires with one unique token, PX expiry, and NX ownership', async () => {
    set.mockResolvedValue('OK');

    await expect(lease.acquire('owner-a')).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith('lock:scoring', 'owner-a', 'PX', 60_000, 'NX');
  });

  it('returns false when another owner already holds the lease', async () => {
    set.mockResolvedValue(null);

    await expect(lease.acquire('owner-b')).resolves.toBe(false);
  });

  it('fails closed when Redis cannot establish ownership', async () => {
    set.mockRejectedValue(new Error('redis unavailable'));

    await expect(lease.acquire('owner-a')).rejects.toBeInstanceOf(RedisLeaseUnavailableError);
  });

  it('renews only when the stored token still matches', async () => {
    evalScript.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(lease.renew('owner-a')).resolves.toBe(true);
    await expect(lease.renew('stale-owner')).resolves.toBe(false);

    expect(evalScript.mock.calls[0]?.[0]).toContain("redis.call('pexpire'");
    expect(evalScript.mock.calls[0]?.slice(1)).toEqual([
      1,
      'lock:scoring',
      'owner-a',
      60_000,
    ]);
  });

  it('releases only when the stored token still matches', async () => {
    evalScript.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(lease.release('owner-a')).resolves.toBe(true);
    await expect(lease.release('stale-owner')).resolves.toBe(false);

    expect(evalScript.mock.calls[0]?.[0]).toContain("redis.call('del'");
    expect(evalScript.mock.calls[0]?.slice(1)).toEqual([1, 'lock:scoring', 'owner-a']);
  });

  it('rejects stale-owner release attempts without falling back', async () => {
    evalScript.mockRejectedValue(new Error('connection reset'));

    await expect(lease.release('owner-a')).rejects.toBeInstanceOf(RedisLeaseUnavailableError);
  });

  it('isolates lease ownership by community', () => {
    expect(scoringLeaseKey('community-gov')).toBe('lock:scoring:community-gov');
    expect(scoringLeaseKey('future-feed')).toBe('lock:scoring:future-feed');
    expect(() => scoringLeaseKey('')).toThrow('must be non-empty');
  });
});

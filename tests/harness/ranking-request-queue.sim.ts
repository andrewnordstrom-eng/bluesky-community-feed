import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import { RankingRequestQueue } from '../../src/scoring/ranking-request-queue.js';

describe('durable ranking request queue integration', () => {
  const queue = new RankingRequestQueue(db);

  beforeEach(async () => {
    await db.query('TRUNCATE TABLE ranking_run_requests CASCADE');
  });

  it('deduplicates scheduled and manual requests by immutable idempotency key', async () => {
    const input = {
      idempotencyKey: 'manual:community-gov:did:plc:admin:123',
      communityId: 'community-gov',
      requestKind: 'manual' as const,
      requestedBy: 'did:plc:admin',
      notBefore: new Date('2026-07-12T05:00:00.000Z'),
    };

    const first = await queue.enqueue(input);
    const duplicate = await queue.enqueue(input);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.id).toBe(first.id);
    const count = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ranking_run_requests');
    expect(count.rows[0]?.count).toBe('1');
  });

  it('allows exactly one concurrent worker to claim one request', async () => {
    await queue.enqueue({
      idempotencyKey: 'scheduled:community-gov:123',
      communityId: 'community-gov',
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });

    const [first, second] = await Promise.all([
      queue.claimNext('worker-a', 'community-gov'),
      queue.claimNext('worker-b', 'community-gov'),
    ]);

    expect([first, second].filter((request) => request !== null)).toHaveLength(1);
    expect([first, second].filter((request) => request === null)).toHaveLength(1);
  });

  it('installs the community-scoped due-work claim index', async () => {
    const result = await db.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'ranking_run_requests'
          AND indexname = 'idx_ranking_run_requests_community_state_due'`
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toContain(
      '(community_id, state, not_before, requested_at, id)'
    );
  });

  it('prevents stale workers from completing another worker claim', async () => {
    await queue.enqueue({
      idempotencyKey: 'manual:community-gov:did:plc:admin:456',
      communityId: 'community-gov',
      requestKind: 'manual',
      requestedBy: 'did:plc:admin',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });
    const claimed = await queue.claimNext('worker-a', 'community-gov');
    expect(claimed).not.toBeNull();

    await expect(queue.complete(claimed!.id, 'worker-b')).rejects.toThrow(
      'is not claimed by worker worker-b'
    );
    await queue.complete(claimed!.id, 'worker-a');

    const state = await db.query<{ state: string }>(
      'SELECT state FROM ranking_run_requests WHERE id = $1',
      [claimed!.id]
    );
    expect(state.rows[0]?.state).toBe('completed');
  });

  it('persists structured failure evidence and rejects the wrong worker', async () => {
    await queue.enqueue({
      idempotencyKey: 'manual:community-gov:did:plc:admin:failed',
      communityId: 'community-gov',
      requestKind: 'manual',
      requestedBy: 'did:plc:admin',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });
    const claimed = await queue.claimNext('worker-a', 'community-gov');
    expect(claimed).not.toBeNull();

    await expect(queue.fail(claimed!.id, 'worker-b', new TypeError('publisher failed')))
      .rejects.toThrow('is not claimed by worker worker-b');
    await expect(queue.defer(claimed!.id, 'worker-b', new Date('2020-01-01T00:00:01.000Z')))
      .rejects.toThrow('is not claimed by worker worker-b');
    await queue.fail(claimed!.id, 'worker-a', new TypeError('publisher failed'));

    const result = await db.query<{
      state: string;
      failure: { name: string; message: string };
      completed_at: Date | null;
    }>(
      'SELECT state, failure, completed_at FROM ranking_run_requests WHERE id = $1',
      [claimed!.id]
    );
    expect(result.rows[0]).toMatchObject({
      state: 'failed',
      failure: { name: 'TypeError', message: 'publisher failed' },
    });
    expect(result.rows[0]?.completed_at).toBeInstanceOf(Date);
  });

  it('returns a deferred request to pending for another worker', async () => {
    await queue.enqueue({
      idempotencyKey: 'scheduled:community-gov:789',
      communityId: 'community-gov',
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });
    const firstClaim = await queue.claimNext('worker-a', 'community-gov');
    expect(firstClaim).not.toBeNull();
    await queue.defer(firstClaim!.id, 'worker-a', new Date('2999-01-01T00:00:00.000Z'));

    await expect(queue.claimNext('worker-b', 'community-gov')).resolves.toBeNull();
    await db.query(
      `UPDATE ranking_run_requests
          SET not_before = NOW() - INTERVAL '1 second'
        WHERE id = $1`,
      [firstClaim!.id]
    );

    const secondClaim = await queue.claimNext('worker-b', 'community-gov');
    expect(secondClaim?.id).toBe(firstClaim!.id);
    expect(secondClaim?.claimedBy).toBe('worker-b');
  });

  it('recovers only stale claimed work after worker termination', async () => {
    await queue.enqueue({
      idempotencyKey: 'scheduled:community-gov:stale',
      communityId: 'community-gov',
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });
    const claimed = await queue.claimNext('dead-worker', 'community-gov');
    expect(claimed).not.toBeNull();
    await db.query(
      `UPDATE ranking_run_requests
          SET claimed_at = NOW() - INTERVAL '10 minutes'
        WHERE id = $1`,
      [claimed!.id]
    );

    const recovered = await queue.requeueStaleClaims(
      new Date(Date.now() - 300_000),
      'community-gov'
    );
    const replacementClaim = await queue.claimNext('replacement-worker', 'community-gov');

    expect(recovered).toBe(1);
    expect(replacementClaim?.id).toBe(claimed!.id);
  });

  it('isolates claims, stale recovery, and health counts by community', async () => {
    await queue.enqueue({
      idempotencyKey: 'scheduled:community-gov:isolation',
      communityId: 'community-gov',
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });
    await queue.enqueue({
      idempotencyKey: 'scheduled:future-feed:isolation',
      communityId: 'future-feed',
      requestKind: 'scheduled',
      requestedBy: 'ranking-worker',
      notBefore: new Date('2020-01-01T00:00:00.000Z'),
    });

    const communityClaim = await queue.claimNext('community-worker', 'community-gov');
    expect(communityClaim?.communityId).toBe('community-gov');
    expect(await queue.claimNext('community-worker-2', 'community-gov')).toBeNull();

    const futureStatus = await queue.status('future-feed');
    expect(futureStatus.pendingCount).toBe(1);
    expect(futureStatus.claimedCount).toBe(0);

    const futureClaim = await queue.claimNext('future-worker', 'future-feed');
    expect(futureClaim?.communityId).toBe('future-feed');
    await db.query(
      `UPDATE ranking_run_requests
          SET claimed_at = NOW() - INTERVAL '10 minutes'
        WHERE id IN ($1, $2)`,
      [communityClaim!.id, futureClaim!.id]
    );

    expect(await queue.requeueStaleClaims(
      new Date(Date.now() - 300_000),
      'community-gov'
    )).toBe(1);
    const futureClaimState = await db.query<{ state: string }>(
      'SELECT state FROM ranking_run_requests WHERE id = $1',
      [futureClaim!.id]
    );
    expect(futureClaimState.rows[0]?.state).toBe('claimed');
  });
});

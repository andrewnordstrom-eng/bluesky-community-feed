import type { Pool, PoolClient } from 'pg';
import { db } from '../db/client.js';
import { enqueueRankingRunRequest } from './ranking-run-contracts.js';

export type RankingRequestKind = 'scheduled' | 'manual' | 'replacement' | 'reconciliation';
export type RankingRequestState = 'pending' | 'claimed' | 'completed' | 'cancelled' | 'failed';

export interface RankingRequest {
  id: string;
  idempotencyKey: string;
  communityId: string;
  requestKind: RankingRequestKind;
  state: RankingRequestState;
  requestedBy: string | null;
  requestedAt: string;
  notBefore: string;
  claimedBy: string | null;
  claimedAt: string | null;
}

export interface EnqueuedRankingRequest {
  id: string;
  created: boolean;
  idempotencyKey: string;
}

export interface RankingQueueStatus {
  pendingCount: number;
  claimedCount: number;
  oldestPendingAt: string | null;
  newestRequestId: string | null;
  newestRequestState: RankingRequestState | null;
}

interface RankingRequestRow {
  id: string;
  idempotency_key: string;
  community_id: string;
  request_kind: RankingRequestKind;
  state: RankingRequestState;
  requested_by: string | null;
  requested_at: Date | string;
  not_before: Date | string;
  claimed_by: string | null;
  claimed_at: Date | string | null;
}

interface QueueStatusRow {
  pending_count: string | number;
  claimed_count: string | number;
  oldest_pending_at: Date | string | null;
  newest_request_id: string | null;
  newest_request_state: RankingRequestState | null;
}

export class RankingRequestQueue {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async enqueue(input: {
    idempotencyKey: string;
    communityId: string;
    requestKind: RankingRequestKind;
    requestedBy: string | null;
    notBefore: Date;
  }): Promise<EnqueuedRankingRequest> {
    assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
    assertNonEmpty(input.communityId, 'communityId');
    const client = await this.pool.connect();
    try {
      const result = await enqueueRankingRunRequest(client, {
        idempotencyKey: input.idempotencyKey,
        communityId: input.communityId,
        requestKind: input.requestKind,
        requestedBy: input.requestedBy,
        notBefore: input.notBefore.toISOString(),
      });
      return { ...result, idempotencyKey: input.idempotencyKey };
    } finally {
      client.release();
    }
  }

  async claimNext(workerId: string): Promise<RankingRequest | null> {
    assertNonEmpty(workerId, 'workerId');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<RankingRequestRow>(
        `WITH candidate AS (
           SELECT id
             FROM ranking_run_requests
            WHERE state = 'pending'
              AND not_before <= NOW()
            ORDER BY not_before ASC, requested_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE ranking_run_requests AS request
            SET state = 'claimed',
                claimed_by = $1,
                claimed_at = NOW(),
                failure = NULL
           FROM candidate
          WHERE request.id = candidate.id
         RETURNING request.id::text, request.idempotency_key,
                   request.community_id, request.request_kind, request.state,
                   request.requested_by, request.requested_at,
                   request.not_before, request.claimed_by, request.claimed_at`,
        [workerId]
      );
      await client.query('COMMIT');
      return result.rows[0] ? mapRequest(result.rows[0]) : null;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(requestId: string, workerId: string): Promise<void> {
    await this.transitionClaimed(requestId, workerId, 'completed', null, null);
  }

  async fail(requestId: string, workerId: string, error: unknown): Promise<void> {
    const failure = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'UnknownError',
    };
    await this.transitionClaimed(requestId, workerId, 'failed', failure, null);
  }

  async defer(requestId: string, workerId: string, notBefore: Date): Promise<void> {
    await this.transitionClaimed(requestId, workerId, 'pending', null, notBefore);
  }

  async status(): Promise<RankingQueueStatus> {
    const result = await this.pool.query<QueueStatusRow>(
      `WITH newest AS (
         SELECT id::text, state
           FROM ranking_run_requests
          ORDER BY requested_at DESC, id DESC
          LIMIT 1
       )
       SELECT
         COUNT(*) FILTER (WHERE state = 'pending') AS pending_count,
         COUNT(*) FILTER (WHERE state = 'claimed') AS claimed_count,
         MIN(requested_at) FILTER (WHERE state = 'pending') AS oldest_pending_at,
         (SELECT id FROM newest) AS newest_request_id,
         (SELECT state FROM newest) AS newest_request_state
       FROM ranking_run_requests`
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Ranking request queue status query returned no row');
    }
    return {
      pendingCount: Number(row.pending_count),
      claimedCount: Number(row.claimed_count),
      oldestPendingAt: row.oldest_pending_at ? toIso(row.oldest_pending_at) : null,
      newestRequestId: row.newest_request_id,
      newestRequestState: row.newest_request_state,
    };
  }

  async requeueStaleClaims(staleBefore: Date): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE ranking_run_requests
          SET state = 'pending',
              claimed_by = NULL,
              claimed_at = NULL,
              not_before = NOW(),
              failure = jsonb_build_object(
                'name', 'StaleClaimRecovered',
                'message', 'Claim recovered after worker termination'
              )
        WHERE state = 'claimed'
          AND claimed_at < $1
       RETURNING id::text`,
      [staleBefore]
    );
    return result.rows.length;
  }

  private async transitionClaimed(
    requestId: string,
    workerId: string,
    nextState: 'pending' | 'completed' | 'failed',
    failure: Record<string, string> | null,
    notBefore: Date | null
  ): Promise<void> {
    assertNonEmpty(requestId, 'requestId');
    assertNonEmpty(workerId, 'workerId');
    const result = await this.pool.query<{ id: string }>(
      `UPDATE ranking_run_requests
          SET state = $3,
              completed_at = CASE WHEN $3 IN ('completed', 'failed') THEN NOW() ELSE NULL END,
              failure = $4::jsonb,
              not_before = COALESCE($5, not_before),
              claimed_by = CASE WHEN $3 = 'pending' THEN NULL ELSE claimed_by END,
              claimed_at = CASE WHEN $3 = 'pending' THEN NULL ELSE claimed_at END
        WHERE id = $1
          AND state = 'claimed'
          AND claimed_by = $2
       RETURNING id::text`,
      [requestId, workerId, nextState, failure ? JSON.stringify(failure) : null, notBefore]
    );
    if (!result.rows[0]) {
      throw new Error(
        `Ranking request ${requestId} is not claimed by worker ${workerId}; cannot transition to ${nextState}`
      );
    }
  }
}

export const rankingRequestQueue = new RankingRequestQueue(db);

export function scheduledRequestKey(communityId: string, at: Date, intervalMs: number): string {
  assertNonEmpty(communityId, 'communityId');
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error(`intervalMs must be a positive integer, got ${intervalMs}`);
  }
  return `scheduled:${communityId}:${Math.floor(at.getTime() / intervalMs)}`;
}

export function manualRequestKey(communityId: string, requestedBy: string, at: Date): string {
  assertNonEmpty(communityId, 'communityId');
  assertNonEmpty(requestedBy, 'requestedBy');
  return `manual:${communityId}:${requestedBy}:${Math.floor(at.getTime() / 60_000)}`;
}

function mapRequest(row: RankingRequestRow): RankingRequest {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    communityId: row.community_id,
    requestKind: row.request_kind,
    state: row.state,
    requestedBy: row.requested_by,
    requestedAt: toIso(row.requested_at),
    notBefore: toIso(row.not_before),
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at ? toIso(row.claimed_at) : null,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    throw new Error('Ranking request transaction failed and rollback also failed', {
      cause: rollbackError,
    });
  }
}

function toIso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ranking request timestamp ${String(value)}`);
  }
  return parsed.toISOString();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} must be non-empty`);
  }
}

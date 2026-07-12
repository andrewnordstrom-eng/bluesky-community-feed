import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  assertRankingRunTransition,
  buildRankingReceipt,
  createCompressedRankingInput,
  decodeCompressedRankingInput,
  reconcilePublishedRankingRun,
  validateRankingReceipt,
} from '../src/scoring/ranking-run-contracts.js';
import { hashCanonicalJson } from '../src/governance/policy-version.js';
import type {
  RankedSlateItem,
  RankingReceipt,
  RankingRunInputEnvelope,
} from '../src/shared/ranking-contracts.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function asClient(query: ReturnType<typeof vi.fn>): PoolClient {
  return { query } as unknown as PoolClient;
}

function envelope(candidates: RankingRunInputEnvelope['candidates']): RankingRunInputEnvelope {
  return {
    schemaVersion: 1,
    runId: '00000000-0000-4000-8000-000000000001',
    communityId: 'community-gov',
    policyHash: HASH_A,
    configurationHash: HASH_B,
    asOf: '2026-07-11T20:00:00.000Z',
    candidates,
  };
}

function item(position: number, uri: string): RankedSlateItem {
  return {
    position,
    postUri: uri,
    postCreatedAt: `2026-07-11T19:59:0${position}.000Z`,
    authorDid: `did:plc:author${position}`,
    componentDecomposition: {
      recency: { raw: 1, weight: 0.2, weighted: 0.2 },
    },
    candidateSources: ['newest'],
    diversityContext: { authorCountBefore: position - 1, raw: 1 },
    baseScore: 0.5,
    finalScore: 0.7,
  };
}

describe('ranking-run state machine', () => {
  it('accepts the success path and rejects reverse or terminal transitions', () => {
    expect(() => assertRankingRunTransition('requested', 'running')).not.toThrow();
    expect(() => assertRankingRunTransition('running', 'validated')).not.toThrow();
    expect(() => assertRankingRunTransition('validated', 'published')).not.toThrow();
    expect(() => assertRankingRunTransition('running', 'requested')).toThrow('Invalid');
    expect(() => assertRankingRunTransition('published', 'running')).toThrow('Invalid');
  });

  it.each(['failed', 'superseded', 'rejected'] as const)(
    'allows running runs to terminate as %s',
    (terminal) => {
      expect(() => assertRankingRunTransition('running', terminal)).not.toThrow();
    }
  );
});

describe('ranking replay inputs', () => {
  it('round-trips canonical gzip input with an exact checksum', () => {
    const original = envelope([
      { uri: 'at://did:plc:a/app.bsky.feed.post/1', eligible: true, features: { recency: 0.9 } },
      { uri: 'at://did:plc:b/app.bsky.feed.post/2', eligible: false, reason: 'deleted' },
    ]);
    const compressed = createCompressedRankingInput(original);
    const replayed = decodeCompressedRankingInput(compressed);

    expect(replayed).toEqual(original);
    expect(compressed.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(compressed.candidateCount).toBe(2);
    expect(compressed.compressedBytes).toBeLessThan(compressed.uncompressedBytes);
  });

  it('round-trips an empty candidate set', () => {
    const original = envelope([]);
    const compressed = createCompressedRankingInput(original);
    expect(decodeCompressedRankingInput(compressed)).toEqual(original);
    expect(compressed.candidateCount).toBe(0);
  });

  it('rejects a checksum mismatch', () => {
    const compressed = createCompressedRankingInput(envelope([{ uri: 'at://post/1' }]));
    expect(() => decodeCompressedRankingInput({
      ...compressed,
      checksum: HASH_C,
    })).toThrow('checksum mismatch');
  });

  it.each([
    ['compressed byte count', 'compressedBytes', 1, 'Compressed ranking input byte count mismatch'],
    ['uncompressed byte count', 'uncompressedBytes', 1, 'Uncompressed ranking input byte count mismatch'],
    ['candidate count', 'candidateCount', 1, 'Ranking input candidate count mismatch'],
  ] as const)('rejects a tampered %s', (_label, field, delta, message) => {
    const compressed = createCompressedRankingInput(envelope([]));
    expect(() => decodeCompressedRankingInput({
      ...compressed,
      [field]: compressed[field] + delta,
    })).toThrow(message);
  });
});

describe('ranking receipts and reconciliation', () => {
  it('binds the exact item order into the receipt checksum', () => {
    const input = createCompressedRankingInput(envelope([{ uri: 'at://post/1' }]));
    const first = buildRankingReceipt({
      runId: '00000000-0000-4000-8000-000000000001',
      communityId: 'community-gov',
      policyVersionId: '00000000-0000-4000-8000-000000000002',
      policyHash: HASH_A,
      algorithmVersion: 'corgi-ranking-v2',
      configurationHash: HASH_B,
      codeSha: 'd'.repeat(40),
      asOf: '2026-07-11T20:00:00.000Z',
      inputChecksum: input.checksum,
      items: [item(1, 'at://post/1'), item(2, 'at://post/2')],
    });
    const second = buildRankingReceipt({
      runId: '00000000-0000-4000-8000-000000000001',
      communityId: 'community-gov',
      policyVersionId: '00000000-0000-4000-8000-000000000002',
      policyHash: HASH_A,
      algorithmVersion: 'corgi-ranking-v2',
      configurationHash: HASH_B,
      codeSha: 'd'.repeat(40),
      asOf: '2026-07-11T20:00:00.000Z',
      inputChecksum: input.checksum,
      items: [item(1, 'at://post/2'), item(2, 'at://post/1')],
    });

    expect(() => validateRankingReceipt(first)).not.toThrow();
    expect(first.itemOrderChecksum).not.toBe(second.itemOrderChecksum);
    expect(first.receiptChecksum).not.toBe(second.receiptChecksum);
  });

  it('rejects a directly tampered receipt checksum', () => {
    const input = createCompressedRankingInput(envelope([]));
    const receipt = buildRankingReceipt({
      runId: '00000000-0000-4000-8000-000000000001',
      communityId: 'community-gov',
      policyVersionId: '00000000-0000-4000-8000-000000000002',
      policyHash: HASH_A,
      algorithmVersion: 'corgi-ranking-v2',
      configurationHash: HASH_B,
      codeSha: 'd'.repeat(40),
      asOf: '2026-07-11T20:00:00.000Z',
      inputChecksum: input.checksum,
      items: [],
    });
    expect(() => validateRankingReceipt({ ...receipt, receiptChecksum: HASH_C }))
      .toThrow('Ranking receipt checksum mismatch');
  });

  it.each([0, 1000])('accepts receipt itemCount boundary %s', (itemCount) => {
    const input = createCompressedRankingInput(envelope([]));
    const receipt = buildRankingReceipt({
      runId: '00000000-0000-4000-8000-000000000001',
      communityId: 'community-gov',
      policyVersionId: '00000000-0000-4000-8000-000000000002',
      policyHash: HASH_A,
      algorithmVersion: 'corgi-ranking-v2',
      configurationHash: HASH_B,
      codeSha: 'd'.repeat(40),
      asOf: '2026-07-11T20:00:00.000Z',
      inputChecksum: input.checksum,
      items: [],
    });
    const { receiptChecksum: _receiptChecksum, ...unsigned } = receipt;
    const adjusted = { ...unsigned, itemCount };
    expect(() => validateRankingReceipt({
      ...adjusted,
      receiptChecksum: hashCanonicalJson(adjusted),
    })).not.toThrow();
  });

  it.each([-1, 1001])('rejects receipt itemCount outside bounds: %s', (itemCount) => {
    const input = createCompressedRankingInput(envelope([]));
    const receipt = buildRankingReceipt({
      runId: '00000000-0000-4000-8000-000000000001',
      communityId: 'community-gov',
      policyVersionId: '00000000-0000-4000-8000-000000000002',
      policyHash: HASH_A,
      algorithmVersion: 'corgi-ranking-v2',
      configurationHash: HASH_B,
      codeSha: 'd'.repeat(40),
      asOf: '2026-07-11T20:00:00.000Z',
      inputChecksum: input.checksum,
      items: [],
    });
    const { receiptChecksum: _receiptChecksum, ...unsigned } = receipt;
    const adjusted = { ...unsigned, itemCount };
    expect(() => validateRankingReceipt({
      ...adjusted,
      receiptChecksum: hashCanonicalJson(adjusted),
    })).toThrow('receipt.itemCount must be an integer in [0, 1000]');
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined] as const)(
    'rejects malformed receipt itemCount: %s',
    (itemCount) => {
      const input = createCompressedRankingInput(envelope([]));
      const receipt = buildRankingReceipt({
        runId: '00000000-0000-4000-8000-000000000001',
        communityId: 'community-gov',
        policyVersionId: '00000000-0000-4000-8000-000000000002',
        policyHash: HASH_A,
        algorithmVersion: 'corgi-ranking-v2',
        configurationHash: HASH_B,
        codeSha: 'd'.repeat(40),
        asOf: '2026-07-11T20:00:00.000Z',
        inputChecksum: input.checksum,
        items: [],
      });
      const malformed = { ...receipt, itemCount } as unknown as RankingReceipt;
      expect(() => validateRankingReceipt(malformed))
        .toThrow('receipt.itemCount must be an integer in [0, 1000]');
    }
  );

  it('repairs validated DB state from matching Redis publication metadata', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id::text') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000001',
            community_id: 'community-gov',
            policy_version_id: '00000000-0000-4000-8000-000000000002',
            policy_hash: HASH_A,
            algorithm_version: 'corgi-ranking-v2',
            configuration_hash: HASH_B,
            code_sha: 'd'.repeat(40),
            as_of: '2026-07-11T20:00:00.000Z',
            state: 'validated',
            selected_count: 1000,
            snapshot_id: null,
            receipt_checksum: HASH_C,
          }],
        };
      }
      return { rows: [] };
    });

    await expect(reconcilePublishedRankingRun(asClient(query), {
      runId: '00000000-0000-4000-8000-000000000001',
      policyHash: HASH_A,
      configurationHash: HASH_B,
      itemCount: 1000,
      snapshotId: 'snapshot-123',
      receiptChecksum: HASH_C,
    })).resolves.toEqual({ repaired: true });

    expect(queries.some((sql) => sql.includes("SET state = 'published'"))).toBe(true);
    expect(queries.some((sql) => sql.includes('redis_publication_reconciled'))).toBe(true);
  });

  it('refuses reconciliation when Redis metadata does not match the DB receipt', async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain('SELECT id::text');
      expect(sql).toContain('FOR UPDATE');
      return {
      rows: [{
        id: '00000000-0000-4000-8000-000000000001',
        community_id: 'community-gov',
        policy_version_id: '00000000-0000-4000-8000-000000000002',
        policy_hash: HASH_A,
        algorithm_version: 'corgi-ranking-v2',
        configuration_hash: HASH_B,
        code_sha: 'd'.repeat(40),
        as_of: '2026-07-11T20:00:00.000Z',
        state: 'validated',
        selected_count: 1000,
        snapshot_id: null,
        receipt_checksum: HASH_C,
      }],
      };
    });

    await expect(reconcilePublishedRankingRun(asClient(query), {
      runId: '00000000-0000-4000-8000-000000000001',
      policyHash: HASH_A,
      configurationHash: HASH_B,
      itemCount: 999,
      snapshotId: 'snapshot-123',
      receiptChecksum: HASH_C,
    })).rejects.toThrow('itemCount');
  });

  it('accepts matching metadata for an already-published run without repairing it', async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain('SELECT id::text');
      expect(sql).toContain('FOR UPDATE');
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000001',
          community_id: 'community-gov',
          policy_version_id: '00000000-0000-4000-8000-000000000002',
          policy_hash: HASH_A,
          algorithm_version: 'corgi-ranking-v2',
          configuration_hash: HASH_B,
          code_sha: 'd'.repeat(40),
          as_of: '2026-07-11T20:00:00.000Z',
          state: 'published',
          selected_count: 1000,
          snapshot_id: 'snapshot-123',
          receipt_checksum: HASH_C,
        }],
      };
    });

    await expect(reconcilePublishedRankingRun(asClient(query), {
      runId: '00000000-0000-4000-8000-000000000001',
      policyHash: HASH_A,
      configurationHash: HASH_B,
      itemCount: 1000,
      snapshotId: 'snapshot-123',
      receiptChecksum: HASH_C,
    })).resolves.toEqual({ repaired: false });
  });

  it('rejects reconciliation from a non-validated active state', async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain('SELECT id::text');
      expect(sql).toContain('FOR UPDATE');
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000001',
          community_id: 'community-gov',
          policy_version_id: '00000000-0000-4000-8000-000000000002',
          policy_hash: HASH_A,
          algorithm_version: 'corgi-ranking-v2',
          configuration_hash: HASH_B,
          code_sha: 'd'.repeat(40),
          as_of: '2026-07-11T20:00:00.000Z',
          state: 'running',
          selected_count: 1000,
          snapshot_id: null,
          receipt_checksum: HASH_C,
        }],
      };
    });

    await expect(reconcilePublishedRankingRun(asClient(query), {
      runId: '00000000-0000-4000-8000-000000000001',
      policyHash: HASH_A,
      configurationHash: HASH_B,
      itemCount: 1000,
      snapshotId: 'snapshot-123',
      receiptChecksum: HASH_C,
    })).rejects.toThrow('Cannot reconcile');
  });
});

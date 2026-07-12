import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import { materializeActivePolicyVersion } from '../../src/governance/policy-version.js';
import {
  buildRankingReceipt,
  cleanupExpiredRankingData,
  createCompressedRankingInput,
  createRankingRun,
  persistRankedSlate,
  persistRankingRunInput,
  prepareRankingRunPublication,
  reconcilePublishedRankingRun,
  transitionRankingRun,
  validateRankingRun,
} from '../../src/scoring/ranking-run-contracts.js';
import type { RankedSlateItem, RankingRunInputEnvelope } from '../../src/shared/ranking-contracts.js';
import { insertActiveEpoch, resetHarnessData } from './helpers.js';

const RUN_ID = '00000000-0000-4000-8000-000000001758';
const CONFIGURATION_HASH = 'b'.repeat(64);
const CODE_SHA = 'c'.repeat(40);
const AS_OF = new Date(Date.now() - 60_000).toISOString();

async function seedGovernedPolicyEvidence(): Promise<number> {
  const epochId = await insertActiveEpoch('Trustworthy Corgi integration epoch');
  const weights = {
    recency: 0.2,
    engagement: 0.2,
    bridging: 0.2,
    sourceDiversity: 0.2,
    relevance: 0.2,
  };
  for (const [componentKey, weight] of Object.entries(weights)) {
    await db.query(
      `INSERT INTO governance_epoch_weights (epoch_id, component_key, weight)
       VALUES ($1, $2, $3)`,
      [epochId, componentKey, weight]
    );
  }
  await db.query(
    `INSERT INTO governance_audit_log (action, epoch_id, details)
     VALUES ('weights_changed', $1, $2::jsonb)`,
    [epochId, JSON.stringify({ new_weights: weights })]
  );
  return epochId;
}

function slateItem(): RankedSlateItem {
  return {
    position: 1,
    postUri: 'at://did:plc:author/app.bsky.feed.post/1',
    postCreatedAt: '2026-07-11T19:59:00.000Z',
    authorDid: 'did:plc:author',
    componentDecomposition: {
      recency: { raw: 1, weight: 0.2, weighted: 0.2 },
      sourceDiversity: { raw: 1, weight: 0.2, weighted: 0.2 },
    },
    candidateSources: ['newest'],
    diversityContext: { authorCountBefore: 0, raw: 1, weighted: 0.2 },
    baseScore: 0.5,
    finalScore: 0.7,
  };
}

describe('Trustworthy Corgi contracts against real PostgreSQL', () => {
  beforeEach(async () => {
    await resetHarnessData();
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  it('materializes an idempotent policy and publishes a receipt-backed run', async () => {
    await seedGovernedPolicyEvidence();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const materialized = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [{
          kind: 'implementation_packet',
          reference: 'PROJ-1758',
          observedAt: AS_OF,
        }],
      });
      await client.query(
        `INSERT INTO governance_audit_log (action, epoch_id, details)
         VALUES ('vote_cast', $1, $2::jsonb)`,
        [materialized.bundle.epochId, JSON.stringify({ voter: 'did:plc:unrelated' })]
      );
      const repeated = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [{
          kind: 'implementation_packet',
          reference: 'PROJ-1758',
          observedAt: AS_OF,
        }],
      });

      expect(materialized.created).toBe(true);
      expect(repeated.created).toBe(false);
      expect(repeated.bundle.policyVersionId).toBe(materialized.bundle.policyVersionId);
      expect(repeated.bundle.policyHash).toBe(materialized.bundle.policyHash);

      await createRankingRun(client, {
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
      });
      await transitionRankingRun(client, RUN_ID, 'running', null);

      const inputEnvelope: RankingRunInputEnvelope = {
        schemaVersion: 1,
        runId: RUN_ID,
        communityId: 'community-gov',
        policyHash: materialized.bundle.policyHash,
        configurationHash: CONFIGURATION_HASH,
        asOf: AS_OF,
        candidates: [{
          uri: 'at://did:plc:author/app.bsky.feed.post/1',
          eligible: true,
          candidateSources: ['newest'],
          features: { recency: 1 },
        }],
      };
      const compressed = createCompressedRankingInput(inputEnvelope);
      const items = [slateItem()];
      await client.query('SAVEPOINT mismatched_input');
      await expect(persistRankingRunInput(
        client,
        RUN_ID,
        createCompressedRankingInput({ ...inputEnvelope, communityId: 'wrong-community' })
      )).rejects.toThrow('Ranking input does not match run identity: communityId');
      await client.query('ROLLBACK TO SAVEPOINT mismatched_input');
      await persistRankingRunInput(client, RUN_ID, compressed);
      await persistRankedSlate(client, RUN_ID, items);
      await persistRankingRunInput(client, RUN_ID, compressed);
      await persistRankedSlate(client, RUN_ID, items);

      const receipt = buildRankingReceipt({
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
        inputChecksum: compressed.checksum,
        items,
      });
      const mismatchedReceipt = buildRankingReceipt({
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
        inputChecksum: compressed.checksum,
        items: [{
          ...slateItem(),
          postUri: 'at://did:plc:author/app.bsky.feed.post/different',
        }],
      });
      await client.query('SAVEPOINT mismatched_receipt');
      await expect(validateRankingRun(client, {
        runId: RUN_ID,
        receipt: mismatchedReceipt,
        candidateCount: 1,
        exclusionCount: 0,
        timings: { totalMs: 42 },
        metrics: { replayDeterministic: true },
      })).rejects.toThrow('item order checksum does not match stored slate');
      await client.query('ROLLBACK TO SAVEPOINT mismatched_receipt');
      await validateRankingRun(client, {
        runId: RUN_ID,
        receipt,
        candidateCount: 1,
        exclusionCount: 0,
        timings: { totalMs: 42 },
        metrics: { replayDeterministic: true },
      });

      await expect(prepareRankingRunPublication(client, RUN_ID, 'integration-test', AS_OF))
        .resolves.toEqual({
          publishable: true,
          currentPolicyHash: materialized.bundle.policyHash,
          replacementRequestId: null,
        });
      await expect(reconcilePublishedRankingRun(client, {
        runId: RUN_ID,
        policyHash: materialized.bundle.policyHash,
        configurationHash: CONFIGURATION_HASH,
        itemCount: 1,
        snapshotId: 'snapshot-integration-1',
        receiptChecksum: receipt.receiptChecksum,
      })).resolves.toEqual({ repaired: true });
      await client.query('SAVEPOINT late_item');
      await expect(client.query(
        `INSERT INTO ranking_run_items (
           run_id, position, post_uri, post_created_at, author_did,
           component_decomposition, candidate_sources, diversity_context,
           base_score, final_score
         ) VALUES ($1, 2, $2, $3, $4, '{}'::jsonb, ARRAY['newest'], '{}'::jsonb, 0.1, 0.1)`,
        [
          RUN_ID,
          'at://did:plc:author/app.bsky.feed.post/late',
          '2026-07-11T19:58:00.000Z',
          'did:plc:author',
        ]
      )).rejects.toThrow('can only be inserted while ranking run');
      await client.query('ROLLBACK TO SAVEPOINT late_item');
      await client.query('COMMIT');

      const policyCount = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM governance_policy_versions'
      );
      const reconciliationCount = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM governance_policy_reconciliation_events'
      );
      const run = await db.query<{
        state: string;
        snapshot_id: string;
        receipt_checksum: string;
      }>(
        `SELECT state, snapshot_id, receipt_checksum::text
           FROM ranking_runs
          WHERE id = $1`,
        [RUN_ID]
      );
      const inputCount = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM ranking_run_inputs WHERE run_id = $1',
        [RUN_ID]
      );
      const itemCount = await db.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM ranking_run_items WHERE run_id = $1',
        [RUN_ID]
      );
      expect(policyCount.rows[0].count).toBe(1);
      expect(reconciliationCount.rows[0].count).toBe(1);
      expect(run.rows[0]).toEqual({
        state: 'published',
        snapshot_id: 'snapshot-integration-1',
        receipt_checksum: receipt.receiptChecksum,
      });
      expect(inputCount.rows[0].count).toBe(1);
      expect(itemCount.rows[0].count).toBe(1);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('enforces the state machine and policy immutability at the database boundary', async () => {
    await seedGovernedPolicyEvidence();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const materialized = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [],
      });
      await createRankingRun(client, {
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
      });
      await transitionRankingRun(client, RUN_ID, 'running', null);
      await client.query('SAVEPOINT invalid_validation');
      await expect(
        client.query("UPDATE ranking_runs SET state = 'validated' WHERE id = $1", [RUN_ID])
      ).rejects.toThrow('must select at least one item');
      await client.query('ROLLBACK TO SAVEPOINT invalid_validation');
      await client.query('SAVEPOINT invalid_transition');
      await expect(
        client.query("UPDATE ranking_runs SET state = 'published' WHERE id = $1", [RUN_ID])
      ).rejects.toThrow('invalid ranking run transition');
      await client.query('ROLLBACK TO SAVEPOINT invalid_transition');

      await client.query('SAVEPOINT immutable_policy');
      await expect(
        client.query(
          'UPDATE governance_policy_versions SET algorithm_version = $2 WHERE id = $1',
          [materialized.bundle.policyVersionId, 'tampered']
        )
      ).rejects.toThrow('append-only and immutable');
      await client.query('ROLLBACK TO SAVEPOINT immutable_policy');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('supersedes a validated run and queues a replacement when policy changes', async () => {
    const epochId = await seedGovernedPolicyEvidence();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const initialPolicy = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [],
      });
      await createRankingRun(client, {
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: initialPolicy.bundle.policyVersionId,
        policyHash: initialPolicy.bundle.policyHash,
        algorithmVersion: initialPolicy.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
      });
      await transitionRankingRun(client, RUN_ID, 'running', null);

      const inputEnvelope: RankingRunInputEnvelope = {
        schemaVersion: 1,
        runId: RUN_ID,
        communityId: 'community-gov',
        policyHash: initialPolicy.bundle.policyHash,
        configurationHash: CONFIGURATION_HASH,
        asOf: AS_OF,
        candidates: [{
          uri: 'at://did:plc:author/app.bsky.feed.post/1',
          eligible: true,
          candidateSources: ['newest'],
          features: { recency: 1 },
        }],
      };
      const compressed = createCompressedRankingInput(inputEnvelope);
      const items = [slateItem()];
      await persistRankingRunInput(client, RUN_ID, compressed);
      await persistRankedSlate(client, RUN_ID, items);
      const receipt = buildRankingReceipt({
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: initialPolicy.bundle.policyVersionId,
        policyHash: initialPolicy.bundle.policyHash,
        algorithmVersion: initialPolicy.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
        inputChecksum: compressed.checksum,
        items,
      });
      await validateRankingRun(client, {
        runId: RUN_ID,
        receipt,
        candidateCount: 1,
        exclusionCount: 0,
        timings: { totalMs: 42 },
        metrics: { replayDeterministic: true },
      });

      await client.query(
        `UPDATE governance_epoch_weights
            SET weight = CASE component_key
              WHEN 'recency' THEN 0.3
              WHEN 'engagement' THEN 0.1
              ELSE weight
            END
          WHERE epoch_id = $1`,
        [epochId]
      );
      await client.query(
        `INSERT INTO governance_audit_log (action, epoch_id, details)
         VALUES ('weights_changed', $1, $2::jsonb)`,
        [epochId, JSON.stringify({ reason: 'stale-policy-regression' })]
      );
      const cutoffResult = await client.query<{ cutoff: Date | string }>(
        'SELECT NOW() AS cutoff'
      );
      const cutoff = new Date(cutoffResult.rows[0].cutoff).toISOString();
      const replacementPolicy = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: cutoff,
        provenanceReferences: [],
      });
      await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: new Date(new Date(cutoff).getTime() + 1).toISOString(),
        provenanceReferences: [],
      });

      const result = await prepareRankingRunPublication(
        client,
        RUN_ID,
        'integration-test',
        new Date(new Date(cutoff).getTime() + 2).toISOString()
      );
      expect(result).toEqual({
        publishable: false,
        currentPolicyHash: replacementPolicy.bundle.policyHash,
        replacementRequestId: expect.any(String),
      });
      const run = await client.query<{ state: string; metrics: Record<string, unknown> }>(
        'SELECT state, metrics FROM ranking_runs WHERE id = $1',
        [RUN_ID]
      );
      expect(run.rows[0]).toEqual({
        state: 'superseded',
        metrics: { replayDeterministic: true },
      });
      const replacement = await client.query<{
        community_id: string;
        request_kind: string;
        state: string;
      }>(
        `SELECT community_id, request_kind, state
           FROM ranking_run_requests
          WHERE id = $1`,
        [result.replacementRequestId]
      );
      expect(replacement.rows[0]).toEqual({
        community_id: 'community-gov',
        request_kind: 'replacement',
        state: 'pending',
      });
      const event = await client.query<{ details: Record<string, unknown> }>(
        `SELECT details
           FROM ranking_run_events
          WHERE run_id = $1 AND event_type = 'stale_policy_detected'`,
        [RUN_ID]
      );
      expect(event.rows[0]?.details).toEqual({
        supersededByPolicyHash: replacementPolicy.bundle.policyHash,
      });
      await client.query('ROLLBACK');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('removes expired manifests with their immutable child events', async () => {
    await seedGovernedPolicyEvidence();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const materialized = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [],
      });
      await createRankingRun(client, {
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
      });
      await client.query(
        `UPDATE ranking_runs
            SET retain_until = NOW() - INTERVAL '1 minute'
          WHERE id = $1`,
        [RUN_ID]
      );
      await transitionRankingRun(client, RUN_ID, 'failed', { reason: 'retention-test' });
      const deleted = await cleanupExpiredRankingData(client, new Date().toISOString());
      expect(deleted).toEqual({ deletedInputs: 0, deletedRuns: 1 });
      const events = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM ranking_run_events WHERE run_id = $1',
        [RUN_ID]
      );
      expect(events.rows[0].count).toBe(0);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('retains expired replay input while its ranking run is active', async () => {
    await seedGovernedPolicyEvidence();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const materialized = await materializeActivePolicyVersion(client, {
        communityId: 'community-gov',
        algorithmVersion: 'corgi-ranking-v2',
        effectiveAt: AS_OF,
        provenanceReferences: [],
      });
      await createRankingRun(client, {
        runId: RUN_ID,
        communityId: 'community-gov',
        policyVersionId: materialized.bundle.policyVersionId,
        policyHash: materialized.bundle.policyHash,
        algorithmVersion: materialized.bundle.algorithmVersion,
        configurationHash: CONFIGURATION_HASH,
        codeSha: CODE_SHA,
        asOf: AS_OF,
      });
      await transitionRankingRun(client, RUN_ID, 'running', null);
      const compressed = createCompressedRankingInput({
        schemaVersion: 1,
        runId: RUN_ID,
        communityId: 'community-gov',
        policyHash: materialized.bundle.policyHash,
        configurationHash: CONFIGURATION_HASH,
        asOf: AS_OF,
        candidates: [],
      });
      await client.query(
        `INSERT INTO ranking_run_inputs (
           run_id, payload, checksum, candidate_count,
           uncompressed_bytes, compressed_bytes, retained_until
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '1 minute')`,
        [
          RUN_ID,
          compressed.payload,
          compressed.checksum,
          compressed.candidateCount,
          compressed.uncompressedBytes,
          compressed.compressedBytes,
        ]
      );

      await expect(cleanupExpiredRankingData(client, new Date().toISOString()))
        .resolves.toEqual({ deletedInputs: 0, deletedRuns: 0 });
      await transitionRankingRun(client, RUN_ID, 'failed', { reason: 'retention-test' });
      await expect(cleanupExpiredRankingData(client, new Date().toISOString()))
        .resolves.toEqual({ deletedInputs: 1, deletedRuns: 0 });
      await client.query('ROLLBACK');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
});

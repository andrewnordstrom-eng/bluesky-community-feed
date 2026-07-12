import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import { scoreBridging, scoreBridgingBatch } from '../../src/scoring/components/bridging.js';
import {
  buildRankingReceipt,
  decodeCompressedRankingInput,
  loadRankingRunInput,
} from '../../src/scoring/ranking-run-contracts.js';
import { replayRankingV2Slate, runRankingV2Shadow } from '../../src/scoring/ranking-v2.js';
import { insertActiveEpoch, resetHarnessData } from './helpers.js';

const CODE_SHA = 'c'.repeat(40);

describe('corgi-ranking-v2 shadow runner against real PostgreSQL', () => {
  beforeEach(async () => {
    await resetHarnessData();
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  it('persists a validated replayable run without publishing Redis state', async () => {
    const asOf = new Date('2026-07-11T20:00:00.000Z');
    await seedPolicy();
    await seedPosts(asOf);

    const result = await runRankingV2Shadow(db, {
      communityId: 'community-gov',
      asOf,
      codeSha: CODE_SHA,
      previousSnapshotPositions: new Map([
        ['at://did:plc:author-a/app.bsky.feed.post/1', 1],
      ]),
    });

    expect(result.candidateCount).toBe(3);
    expect(result.selectedCount).toBe(3);
    const stored = await db.query<{
      state: string;
      candidate_count: number;
      selected_count: number;
      receipt_checksum: string;
    }>(
      `SELECT state, candidate_count, selected_count, receipt_checksum
         FROM ranking_runs
        WHERE id = $1`,
      [result.context.runId]
    );
    expect(stored.rows[0]).toMatchObject({
      state: 'validated',
      candidate_count: 3,
      selected_count: 3,
      receipt_checksum: result.receipt.receiptChecksum,
    });
    const redisKeys = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ranking_run_items WHERE run_id = $1`,
      [result.context.runId]
    );
    expect(redisKeys.rows[0].count).toBe(3);

    const client = await db.connect();
    try {
      const compressed = await loadRankingRunInput(client, result.context.runId);
      const envelope = decodeCompressedRankingInput(compressed);
      const replayedSlate = replayRankingV2Slate(
        envelope,
        result.context.policy.weights.sourceDiversity
      );
      const replayedReceipt = buildRankingReceipt({
        runId: result.context.runId,
        communityId: result.context.communityId,
        policyVersionId: result.context.policy.policyVersionId,
        policyHash: result.context.policy.policyHash,
        algorithmVersion: result.context.algorithmVersion,
        configurationHash: result.context.configurationHash,
        codeSha: result.context.codeSha,
        asOf: result.context.asOf,
        inputChecksum: compressed.checksum,
        items: replayedSlate,
      });
      expect(replayedReceipt.itemOrderChecksum).toBe(result.receipt.itemOrderChecksum);
      expect(replayedReceipt.receiptChecksum).toBe(result.receipt.receiptChecksum);
    } finally {
      client.release();
    }
  });

  it('reproduces the exact item order for the same asOf and policy', async () => {
    const asOf = new Date('2026-07-11T20:00:00.000Z');
    await seedPolicy();
    await seedPosts(asOf);
    const options = {
      communityId: 'community-gov',
      asOf,
      codeSha: CODE_SHA,
      previousSnapshotPositions: new Map<string, number>(),
    };

    const first = await runRankingV2Shadow(db, options);
    const second = await runRankingV2Shadow(db, options);

    expect(second.receipt.itemOrderChecksum).toBe(first.receipt.itemOrderChecksum);
    expect(second.receipt.inputChecksum).not.toBe(first.receipt.inputChecksum);
    const orders = await Promise.all([first.context.runId, second.context.runId].map(async (runId) => {
      const rows = await db.query<{ post_uri: string }>(
        `SELECT post_uri FROM ranking_run_items WHERE run_id = $1 ORDER BY position`,
        [runId]
      );
      return rows.rows.map((row) => row.post_uri);
    }));
    expect(orders[1]).toEqual(orders[0]);
  });

  it('matches the legacy single-post bridging calculation with batched queries', async () => {
    const asOf = new Date('2026-07-11T20:00:00.000Z');
    await seedPolicy();
    await seedPosts(asOf);
    const uri = 'at://did:plc:author-a/app.bsky.feed.post/1';
    await seedBridgingEvidence(uri, asOf);
    const post = {
      uri,
      cid: 'cid-1',
      authorDid: 'did:plc:author-a',
      text: 'corgi community post',
      replyRoot: null,
      replyParent: null,
      langs: ['en'],
      hasMedia: false,
      createdAt: new Date(asOf.getTime() - 60 * 60 * 1000),
      likeCount: 2,
      repostCount: 0,
      replyCount: 0,
      topicVector: { corgi: 0.8 },
      classificationMethod: 'keyword' as const,
    };

    const legacy = await scoreBridging(uri, post.authorDid);
    const client = await db.connect();
    try {
      const batch = await scoreBridgingBatch(client, [post]);
      const evidence = batch.get(`${uri}\u0000${post.createdAt.toISOString()}`);
      expect(evidence?.evidenceState).toBe('observed');
      expect(evidence?.raw).toBeCloseTo(legacy, 12);
    } finally {
      client.release();
    }
  });

  it('persists an explicit failed state when a shadow run has no candidates', async () => {
    const asOf = new Date('2026-07-11T20:00:00.000Z');
    await seedPolicy();

    await expect(runRankingV2Shadow(db, {
      communityId: 'community-gov',
      asOf,
      codeSha: CODE_SHA,
      previousSnapshotPositions: new Map(),
    })).rejects.toThrow(/no eligible candidates/);

    const stored = await db.query<{ state: string; failure: { message: string } }>(
      `SELECT state, failure
         FROM ranking_runs
        ORDER BY created_at DESC
        LIMIT 1`
    );
    expect(stored.rows[0].state).toBe('failed');
    expect(stored.rows[0].failure.message).toMatch(/no eligible candidates/);
  });
});

async function seedPolicy(): Promise<void> {
  const epochId = await insertActiveEpoch('ranking v2 shadow epoch');
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
}

async function seedPosts(asOf: Date): Promise<void> {
  const posts = [
    ['author-a', '1', 1, 1, 0],
    ['author-a', '2', 5, 0, 0],
    ['author-b', '3', 2, 1, 1],
  ] as const;
  for (let index = 0; index < posts.length; index += 1) {
    const [author, rkey, likes, reposts, replies] = posts[index];
    const uri = `at://did:plc:${author}/app.bsky.feed.post/${rkey}`;
    const createdAt = new Date(asOf.getTime() - ((index + 1) * 60 * 60 * 1000));
    await db.query(
      `INSERT INTO posts (
         uri, cid, author_did, text, langs, has_media, created_at,
         topic_vector, classification_method, deleted
       ) VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7::jsonb, 'keyword', FALSE)`,
      [uri, `cid-${rkey}`, `did:plc:${author}`, 'corgi community post', ['en'], createdAt, JSON.stringify({ corgi: 0.8 })]
    );
    await db.query(
      `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count)
       VALUES ($1, $2, $3, $4)`,
      [uri, likes, reposts, replies]
    );
  }
}

async function seedBridgingEvidence(uri: string, asOf: Date): Promise<void> {
  const engagers = ['did:plc:engager-a', 'did:plc:engager-b'];
  for (let index = 0; index < engagers.length; index += 1) {
    await db.query(
      `INSERT INTO likes (uri, author_did, subject_uri, created_at, deleted)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [`at://${engagers[index]}/app.bsky.feed.like/${index}`, engagers[index], uri, asOf]
    );
  }
  const follows = [
    [engagers[0], 'did:plc:shared'],
    [engagers[0], 'did:plc:left'],
    [engagers[1], 'did:plc:shared'],
    [engagers[1], 'did:plc:right'],
  ] as const;
  for (let index = 0; index < follows.length; index += 1) {
    await db.query(
      `INSERT INTO follows (uri, author_did, subject_did, created_at, deleted)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [`at://${follows[index][0]}/app.bsky.graph.follow/${index}`, follows[index][0], follows[index][1], asOf]
    );
  }
}

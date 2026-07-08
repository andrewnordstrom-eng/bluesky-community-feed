/**
 * PROJ-917: partition lifecycle integration suite.
 *
 * Proves, against a real postgres:16 Testcontainer running the REAL
 * migration runner (migrations 026-029 — see tests/harness/global-setup.ts),
 * that the native time-partitioned schema rebuild actually works:
 *
 *  (a) migrations build the partitioned schema (likes/reposts/follows/posts/
 *      post_scores/post_score_components are declaratively RANGE-partitioned
 *      by created_at, with today's daily partition already present).
 *  (b) inserts route to the correct daily partition.
 *  (c) src/maintenance/partition-manager.ts creates partitions ahead of time
 *      and DETACHes+DROPs partitions past their retention window — a
 *      dropped partition's rows vanish instantly (row count AND
 *      pg_total_relation_size, not a DELETE that leaves dead tuples for
 *      autovacuum), and the posts-drop path cascades to post_engagement
 *      (the FK CASCADE that migration 027 had to drop).
 *  (d) representative reads — a 72h scoring-window join of posts+post_scores
 *      (the shape of src/scoring/pipeline.ts's writeToRedisFromDb query),
 *      and the real scoreBridging() component reading likes/reposts/follows
 *      — still return correct results against the partitioned tables.
 *
 * Uses direct SQL for seeding (not the A1 population/scenario harness):
 * this suite needs exact, individually-controlled `created_at` values to
 * pin rows to specific day partitions (including partitions well outside
 * the default retention window, to exercise dropOldPartitions), which the
 * scenario-generator seeders aren't built for. tests/harness/helpers.ts's
 * resetHarnessData/insertActiveEpoch are reused where they fit directly.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import { scoreBridging } from '../../src/scoring/components/bridging.js';
import { runPartitionMaintenanceNow } from '../../src/maintenance/partition-manager.js';
import { config } from '../../src/config.js';
import { resetHarnessData, insertActiveEpoch } from './helpers.js';

const PARTITIONED_TABLES = [
  'likes',
  'reposts',
  'follows',
  'posts',
  'post_scores',
  'post_score_components',
] as const;

async function getServerToday(): Promise<Date> {
  const result = await db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  const [year, month, day] = result.rows[0].today.split('-').map((p) => parseInt(p, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateSuffix(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function partitionName(table: string, date: Date): string {
  return `${table}_p${dateSuffix(date)}`;
}

async function regclassExists(name: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`,
    [name]
  );
  return result.rows[0]?.exists === true;
}

async function relkind(table: string): Promise<string | null> {
  const result = await db.query<{ relkind: string }>(
    `SELECT relkind FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
    [table]
  );
  return result.rows[0]?.relkind ?? null;
}

describe('partition lifecycle (PROJ-917)', () => {
  let today: Date;

  beforeAll(async () => {
    today = await getServerToday();
  });

  afterEach(async () => {
    await resetHarnessData();
  });

  // ── (a) migrations build the partitioned schema ──────────────────

  it('migrations 026-029 rebuilt all six tables as declaratively RANGE-partitioned', async () => {
    for (const table of PARTITIONED_TABLES) {
      expect(await relkind(table), `${table} should be relkind 'p' (partitioned table)`).toBe('p');
    }
  });

  it("today's daily partition already exists for every partitioned table (created by the migrations' initial window)", async () => {
    for (const table of PARTITIONED_TABLES) {
      const name = partitionName(table, today);
      expect(await regclassExists(name), `${name} should exist`).toBe(true);
    }
  });

  it('each table also has a DEFAULT partition as an out-of-range safety net', async () => {
    for (const table of PARTITIONED_TABLES) {
      expect(await regclassExists(`${table}_default`)).toBe(true);
    }
  });

  // ── (b) inserts route to the correct daily partition ─────────────

  it('a like inserted for "today" is physically stored in the corresponding daily partition', async () => {
    const uri = 'at://did:plc:partition-test/app.bsky.feed.like/routing-1';
    await db.query(
      `INSERT INTO likes (uri, author_did, subject_uri, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (uri, created_at) DO NOTHING`,
      [uri, 'did:plc:partition-test-liker', 'at://did:plc:partition-test/app.bsky.feed.post/subject']
    );

    const result = await db.query<{ partition: string }>(
      `SELECT tableoid::regclass::text AS partition FROM likes WHERE uri = $1`,
      [uri]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].partition).toBe(partitionName('likes', today));
  });

  it('a post inserted for "today" is physically stored in the corresponding daily partition', async () => {
    const uri = 'at://did:plc:partition-test/app.bsky.feed.post/routing-2';
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, created_at)
       VALUES ($1, 'cid-routing-2', 'did:plc:partition-test-author', NOW())
       ON CONFLICT (uri, created_at) DO NOTHING`,
      [uri]
    );

    const result = await db.query<{ partition: string }>(
      `SELECT tableoid::regclass::text AS partition FROM posts WHERE uri = $1`,
      [uri]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].partition).toBe(partitionName('posts', today));
  });

  // ── (c) partition-manager: create-ahead + drop-old + cascade + instant vanish ──

  it('runPartitionMaintenanceNow() re-creates a missing "create-ahead" partition', async () => {
    const aheadDate = addDays(today, 2);
    const aheadName = partitionName('likes', aheadDate);

    // The initial migration window already created this partition ([today,
    // today+2]) — drop it so we can prove partition-manager creates it back.
    expect(await regclassExists(aheadName)).toBe(true);
    await db.query(`ALTER TABLE likes DETACH PARTITION ${aheadName}`);
    await db.query(`DROP TABLE ${aheadName}`);
    expect(await regclassExists(aheadName)).toBe(false);

    const result = await runPartitionMaintenanceNow();
    if (result === null) throw new Error('partition maintenance unexpectedly skipped');

    expect(await regclassExists(aheadName)).toBe(true);
    expect(result.partitionsCreated).toContain(aheadName);
    expect(result.errors).toEqual([]);
  });

  it('runPartitionMaintenanceNow() drops a partition past its retention window — rows and disk space vanish instantly', async () => {
    // Well beyond RAW_EVENT_RETENTION_DAYS (default 14) and outside the
    // migrations' initial window ([today-16d, today+2d]), so this partition
    // does not already exist and must be created here for the test.
    const oldDate = addDays(today, -(config.RAW_EVENT_RETENTION_DAYS + 6));
    const oldName = partitionName('likes', oldDate);

    await db.query(`SELECT create_daily_range_partitions('likes', 'likes', $1::date, $1::date)`, [
      oldDate.toISOString().slice(0, 10),
    ]);
    expect(await regclassExists(oldName)).toBe(true);

    // Seed enough rows that the partition has a real, non-trivial disk
    // footprint — a meaningful contrast against a plain DELETE, which would
    // leave that same footprint behind as dead tuples until VACUUM.
    const rowCount = 300;
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < rowCount; i++) {
      const base = i * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(
        `at://did:plc:partition-test/app.bsky.feed.like/old-${i}`,
        `did:plc:partition-test-old-liker-${i}`,
        'at://did:plc:partition-test/app.bsky.feed.post/old-subject',
        new Date(oldDate.getTime() + i * 60_000).toISOString()
      );
    }
    await db.query(
      `INSERT INTO likes (uri, author_did, subject_uri, created_at) VALUES ${values.join(', ')}`,
      params
    );

    const countBefore = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${oldName}`
    );
    expect(parseInt(countBefore.rows[0].count, 10)).toBe(rowCount);

    const sizeBefore = await db.query<{ size: string }>(
      `SELECT pg_total_relation_size(to_regclass('public.' || $1))::text AS size`,
      [oldName]
    );
    expect(parseInt(sizeBefore.rows[0].size, 10)).toBeGreaterThan(0);

    const result = await runPartitionMaintenanceNow();
    if (result === null) throw new Error('partition maintenance unexpectedly skipped');

    expect(result.partitionsDropped).toContain(oldName);
    expect(result.errors).toEqual([]);

    // The partition relation itself is gone — not just empty. DROP TABLE
    // unlinks the file immediately; a DELETE of the same rows would leave
    // this same disk footprint present (as dead tuples) until VACUUM.
    expect(await regclassExists(oldName)).toBe(false);

    // Rows are gone from the parent's point of view too, instantly.
    const liveCount = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM likes
       WHERE subject_uri = 'at://did:plc:partition-test/app.bsky.feed.post/old-subject'`
    );
    expect(parseInt(liveCount.rows[0].count, 10)).toBe(0);

    // A live, in-retention partition (today's) must survive the same run.
    expect(await regclassExists(partitionName('likes', today))).toBe(true);
  });

  it('dropping an old posts partition cascades to post_engagement (the FK CASCADE dropped in migration 027)', async () => {
    const oldDate = addDays(today, -(config.SCORED_DATA_RETENTION_DAYS + 5));
    const oldName = partitionName('posts', oldDate);

    await db.query(`SELECT create_daily_range_partitions('posts', 'posts', $1::date, $1::date)`, [
      oldDate.toISOString().slice(0, 10),
    ]);

    const postUri = 'at://did:plc:partition-test/app.bsky.feed.post/engagement-cascade';
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, created_at) VALUES ($1, 'cid-cascade', 'did:plc:partition-test-author', $2)`,
      [postUri, oldDate.toISOString()]
    );
    await db.query(
      `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count) VALUES ($1, 3, 1, 0)`,
      [postUri]
    );

    const engagementBefore = await db.query(`SELECT 1 FROM post_engagement WHERE post_uri = $1`, [postUri]);
    expect(engagementBefore.rows).toHaveLength(1);

    const result = await runPartitionMaintenanceNow();
    if (result === null) throw new Error('partition maintenance unexpectedly skipped');

    expect(result.partitionsDropped).toContain(oldName);
    expect(result.engagementRowsCascaded).toBeGreaterThanOrEqual(1);

    const engagementAfter = await db.query(`SELECT 1 FROM post_engagement WHERE post_uri = $1`, [postUri]);
    expect(engagementAfter.rows).toHaveLength(0);
  });

  it('cascade deletes ALL post_engagement rows when the dropped posts partition exceeds BATCH_SIZE (regression for the self-advancing batch loop)', async () => {
    const oldDate = addDays(today, -(config.SCORED_DATA_RETENTION_DAYS + 7));
    const oldName = partitionName('posts', oldDate);
    await db.query(`SELECT create_daily_range_partitions('posts', 'posts', $1::date, $1::date)`, [
      oldDate.toISOString().slice(0, 10),
    ]);

    // > BATCH_SIZE (5000). The prior cascade re-selected the same static 5000
    // URIs from the posts partition every iteration, so once their engagement
    // rows were gone the loop exited and orphaned everything past the first
    // batch. This seeds 5200 to prove the fix drains the whole partition.
    const rowCount = 5200;
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, created_at)
       SELECT 'at://did:plc:cascade-vol/app.bsky.feed.post/' || g, 'cid', 'did:plc:cascade-vol', $1::timestamptz
       FROM generate_series(1, $2) g`,
      [oldDate.toISOString(), rowCount]
    );
    await db.query(
      `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count)
       SELECT uri, 1, 0, 0 FROM ${oldName}`
    );
    const before = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM post_engagement WHERE post_uri LIKE 'at://did:plc:cascade-vol/%'`
    );
    expect(parseInt(before.rows[0].count, 10)).toBe(rowCount);

    const result = await runPartitionMaintenanceNow();
    if (result === null) throw new Error('partition maintenance unexpectedly skipped');

    expect(result.partitionsDropped).toContain(oldName);
    expect(result.engagementRowsCascaded).toBeGreaterThanOrEqual(rowCount);

    // No orphans: every engagement row for the dropped partition's posts is gone.
    const after = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM post_engagement WHERE post_uri LIKE 'at://did:plc:cascade-vol/%'`
    );
    expect(parseInt(after.rows[0].count, 10)).toBe(0);
  });

  // ── (d) representative reads still return correct results ────────

  it('a 72h scoring-window read joining posts+post_scores returns only in-window rows, correctly ranked', async () => {
    const epochId = await insertActiveEpoch('partition-lifecycle scoring window test');

    const inWindowUri = 'at://did:plc:partition-test/app.bsky.feed.post/in-window';
    const outOfWindowUri = 'at://did:plc:partition-test/app.bsky.feed.post/out-of-window';
    const inWindowCreatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    const outOfWindowCreatedAt = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago

    for (const [uri, createdAt] of [
      [inWindowUri, inWindowCreatedAt],
      [outOfWindowUri, outOfWindowCreatedAt],
    ] as const) {
      await db.query(
        `INSERT INTO posts (uri, cid, author_did, created_at) VALUES ($1, 'cid', 'did:plc:partition-test-author', $2)`,
        [uri, createdAt.toISOString()]
      );

      // Mirrors src/scoring/pipeline.ts's storeScore(): created_at is
      // resolved via a subquery against posts (immutable partition key),
      // not supplied as a literal — proving that exact construct works
      // against the real partitioned schema.
      await db.query(
        `INSERT INTO post_scores (
          post_uri, epoch_id,
          recency_score, engagement_score, bridging_score, source_diversity_score, relevance_score,
          recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight,
          recency_weighted, engagement_weighted, bridging_weighted, source_diversity_weighted, relevance_weighted,
          total_score, created_at
        ) VALUES ($1, $2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1,
          ${uri === inWindowUri ? '0.9' : '0.1'},
          COALESCE((SELECT created_at FROM posts WHERE uri = $1), NOW()))
        ON CONFLICT (post_uri, epoch_id, created_at) DO UPDATE SET total_score = EXCLUDED.total_score`,
        [uri, epochId]
      );
    }

    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const result = await db.query<{ post_uri: string; total_score: number }>(
      `SELECT ps.post_uri, ps.total_score
       FROM post_scores ps
       JOIN posts p ON p.uri = ps.post_uri
       WHERE ps.epoch_id = $1
         AND p.deleted = FALSE
         AND p.created_at > $2
         AND p.created_at <= NOW()
       ORDER BY ps.total_score DESC`,
      [epochId, cutoff.toISOString()]
    );

    expect(result.rows.map((r) => r.post_uri)).toEqual([inWindowUri]);
    expect(result.rows[0].total_score).toBeCloseTo(0.9, 5);
  });

  it('scoreBridging() (real production component) still distinguishes disjoint vs. overlapping engager networks across partitioned likes/reposts/follows', async () => {
    // Case A: two engagers whose follow sets are completely disjoint -> high bridging.
    const disjointSubject = 'at://did:plc:partition-test/app.bsky.feed.post/bridging-disjoint';
    await seedLike(disjointSubject, 'did:plc:bridge-engager-a1');
    await seedLike(disjointSubject, 'did:plc:bridge-engager-a2');
    await seedFollow('did:plc:bridge-engager-a1', 'did:plc:bridge-followee-1');
    await seedFollow('did:plc:bridge-engager-a1', 'did:plc:bridge-followee-2');
    await seedFollow('did:plc:bridge-engager-a2', 'did:plc:bridge-followee-3');
    await seedFollow('did:plc:bridge-engager-a2', 'did:plc:bridge-followee-4');

    const disjointScore = await scoreBridging(disjointSubject, 'did:plc:partition-test-author');
    expect(disjointScore).toBeCloseTo(1.0, 5);

    // Case B: two engagers with identical follow sets -> low bridging.
    const overlappingSubject = 'at://did:plc:partition-test/app.bsky.feed.post/bridging-overlap';
    await seedLike(overlappingSubject, 'did:plc:bridge-engager-b1');
    await seedLike(overlappingSubject, 'did:plc:bridge-engager-b2');
    await seedFollow('did:plc:bridge-engager-b1', 'did:plc:bridge-followee-x');
    await seedFollow('did:plc:bridge-engager-b1', 'did:plc:bridge-followee-y');
    await seedFollow('did:plc:bridge-engager-b2', 'did:plc:bridge-followee-x');
    await seedFollow('did:plc:bridge-engager-b2', 'did:plc:bridge-followee-y');

    const overlappingScore = await scoreBridging(overlappingSubject, 'did:plc:partition-test-author');
    expect(overlappingScore).toBeCloseTo(0.0, 5);
  });
});

async function seedLike(subjectUri: string, authorDid: string): Promise<void> {
  await db.query(
    `INSERT INTO likes (uri, author_did, subject_uri, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (uri, created_at) DO NOTHING`,
    [`${subjectUri}-like-by-${authorDid}`, authorDid, subjectUri]
  );
}

async function seedFollow(authorDid: string, subjectDid: string): Promise<void> {
  await db.query(
    `INSERT INTO follows (uri, author_did, subject_did, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (uri, created_at) DO NOTHING`,
    [`at://${authorDid}/app.bsky.graph.follow/${subjectDid.replace(/[^a-zA-Z0-9]/g, '')}`, authorDid, subjectDid]
  );
}

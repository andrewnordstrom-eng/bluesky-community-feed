import { db } from '../../src/db/client.js';
import { handleLike } from '../../src/ingestion/handlers/like-handler.js';
import {
  AssertionResult,
  ScenarioResult,
  ensureActiveEpoch,
  nowIso,
  summarizeAssertions,
} from './_helpers.js';

const LIKE_CONCURRENCY = 50;

export async function runConcurrentWritesStress(): Promise<ScenarioResult> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const assertions: AssertionResult[] = [];
  const errors: string[] = [];

  const postUri = 'at://did:plc:concurrent-author/app.bsky.feed.post/target';

  try {
    const epochId = await ensureActiveEpoch();

    await db.query('TRUNCATE TABLE likes, post_engagement, posts, engagement_attributions RESTART IDENTITY CASCADE');

    await db.query(
      // PROJ-917: posts' PK widened to (uri, created_at) — partitioned
      // tables require the partition key in every unique constraint.
      `INSERT INTO posts (uri, cid, author_did, text, created_at, indexed_at, deleted)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), FALSE)
       ON CONFLICT (uri, created_at) DO NOTHING`,
      [postUri, 'cid-concurrent', 'did:plc:concurrent-author', 'concurrent write stress target']
    );

    await db.query(
      `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count, updated_at)
       VALUES ($1, 0, 0, 0, NOW())
       ON CONFLICT (post_uri) DO UPDATE SET updated_at = NOW()`,
      [postUri]
    );

    const attributionValues: string[] = [];
    const attributionParams: unknown[] = [];
    for (let i = 0; i < LIKE_CONCURRENCY; i++) {
      const base = i * 4;
      attributionValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, NOW(), $${base + 4})`);
      attributionParams.push(postUri, `did:plc:liker${i}`, epochId, i);
    }

    await db.query(
      `INSERT INTO engagement_attributions (post_uri, viewer_did, epoch_id, served_at, position_in_feed)
       VALUES ${attributionValues.join(', ')}
       ON CONFLICT (post_uri, viewer_did, epoch_id) DO NOTHING`,
      attributionParams
    );

    const likeOps = Array.from({ length: LIKE_CONCURRENCY }, (_, i) =>
      handleLike(
        `at://did:plc:liker${i}/app.bsky.feed.like/${i}`,
        `did:plc:liker${i}`,
        { subject: { uri: postUri }, createdAt: new Date().toISOString() }
      )
    );

    await Promise.all(likeOps);

    // Allow fire-and-forget attribution updates to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    const counts = await db.query<{
      like_count: number;
      likes_total: string;
      likes_distinct: string;
      engaged_total: string;
      duplicate_like_uris: string;
    }>(
      `SELECT
         (SELECT like_count FROM post_engagement WHERE post_uri = $1) AS like_count,
         (SELECT COUNT(*)::text FROM likes WHERE subject_uri = $1 AND deleted = FALSE) AS likes_total,
         (SELECT COUNT(DISTINCT uri)::text FROM likes WHERE subject_uri = $1 AND deleted = FALSE) AS likes_distinct,
         (SELECT COUNT(*)::text FROM engagement_attributions
          WHERE post_uri = $1 AND epoch_id = $2 AND engaged_at IS NOT NULL) AS engaged_total,
         (SELECT (COUNT(*) - COUNT(DISTINCT uri))::text FROM likes WHERE subject_uri = $1) AS duplicate_like_uris`,
      [postUri, epochId]
    );

    const row = counts.rows[0];
    const likeCount = Number(row.like_count ?? 0);
    const likesTotal = parseInt(row.likes_total ?? '0', 10);
    const likesDistinct = parseInt(row.likes_distinct ?? '0', 10);
    const engagedTotal = parseInt(row.engaged_total ?? '0', 10);
    const duplicateLikeUris = parseInt(row.duplicate_like_uris ?? '0', 10);

    assertions.push({
      name: 'like_count_exact_50',
      pass: likeCount === LIKE_CONCURRENCY,
      detail: `like_count=${likeCount}`,
    });
    assertions.push({
      name: 'no_duplicate_likes',
      pass: likesTotal === likesDistinct && duplicateLikeUris === 0,
      detail: `likes_total=${likesTotal}, likes_distinct=${likesDistinct}, duplicate_uris=${duplicateLikeUris}`,
    });
    assertions.push({
      name: 'attribution_not_double_counted',
      pass: engagedTotal === LIKE_CONCURRENCY,
      detail: `engaged_total=${engagedTotal}`,
    });

    return {
      name: 'concurrent-write-safety',
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: summarizeAssertions(assertions),
      metrics: {
        concurrency: LIKE_CONCURRENCY,
        likeCount,
        likesTotal,
        likesDistinct,
        engagedTotal,
        duplicateLikeUris,
      },
      assertions,
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      name: 'concurrent-write-safety',
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: false,
      metrics: {},
      assertions,
      errors,
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runConcurrentWritesStress()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(1);
    });
}

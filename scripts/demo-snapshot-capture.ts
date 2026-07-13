import { writeFile } from 'node:fs/promises';
import { db } from '../src/db/client.js';
import { redis } from '../src/db/redis.js';
import { config } from '../src/config.js';
import { loadShadowDemoCorpus, communityGovSnapshotGateFailures } from '../src/demo/corpus.js';
import {
  canonicalizeFrozenEmbedUrl,
  createBoundedDemoFetch,
  scoreCompletenessRate,
} from '../src/demo/snapshot-capture.js';
import { readPostScore, type PostScoreRecord } from '../src/scoring/score-reader.js';
import { FEED_URL_DEDUP_DECAY } from '../src/scoring/feed-publication.js';
import { internalRawScoresToShadow } from '../src/demo/weights.js';
import {
  createLivePublishedFeedSnapshotReader,
  communityGovManifestDigest,
  COMMUNITY_GOV_ACTIVE_TOPIC_COUNT,
  DEMO_SOURCE_SNAPSHOT_LIMIT,
  type PublishedFeedSnapshot,
} from '../src/feed/demo-snapshot-source.js';

interface CapturePaths {
  manifest: string;
  report: string;
  reviewSheet: string;
}

const APPVIEW_REQUEST_TIMEOUT_MS = 8_000;
const SCORE_READ_BATCH_SIZE = 10;
const appViewFetch = createBoundedDemoFetch(APPVIEW_REQUEST_TIMEOUT_MS);

async function main(): Promise<void> {
  try {
    const paths = parsePaths(process.argv.slice(2));
    const capturedAt = new Date();
    const readLiveSnapshot = createLivePublishedFeedSnapshotReader();
    const snapshot = await readLiveSnapshot(DEMO_SOURCE_SNAPSHOT_LIMIT);
    const capturedPolicy = await readCapturedPolicy(snapshot.productionEpochId);
    const scores: Array<Awaited<ReturnType<typeof readPostScore>>> = [];
    for (let start = 0; start < snapshot.entries.length; start += SCORE_READ_BATCH_SIZE) {
      const batch = snapshot.entries.slice(start, start + SCORE_READ_BATCH_SIZE);
      scores.push(...await Promise.all(batch.map((entry) => readPostScore({
        postUri: entry.uri,
        epochId: snapshot.productionEpochId,
      }))));
    }
    const frozenEntries = await buildFrozenEntries(snapshot, scores);
    const frozenSnapshot: PublishedFeedSnapshot = { ...snapshot, entries: frozenEntries };
    const corpus = await loadShadowDemoCorpus({
      communityId: 'community_gov',
      now: capturedAt,
      fetchFn: appViewFetch,
      dbPool: db,
      readScore: readPostScore,
      readPublishedSnapshot: async () => frozenSnapshot,
    });
    const publicItems = corpus.items.filter((item) => item.displayPost.kind === 'public_post');
    const reviewedCidByUri = new Map(publicItems.flatMap((item) =>
      item.displayPost.kind === 'public_post' ? [[item.postUri, item.displayPost.cid] as const] : []));
    const approvedEntries = frozenEntries.map((entry) => ({
      ...entry,
      frozen: entry.frozen
        ? { ...entry.frozen, reviewedCid: reviewedCidByUri.get(entry.uri) ?? null }
        : entry.frozen,
    }));
    const manifestPayload = {
      schemaVersion: '2026-07-11.community-gov-snapshot.v3',
      feedUri: snapshot.feedUri,
      feedName: snapshot.feedName,
      productionEpochId: snapshot.productionEpochId,
      sourceRunId: snapshot.sourceRunId,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      capturedAt: capturedAt.toISOString(),
      reviewedAt: null,
      selectionPolicyVersion: 'community-gov-reviewer-safe-v1',
      baselineOrderDigest: snapshot.baselineOrderDigest,
      signalWeights: capturedPolicy.signalWeights,
      publicationPolicy: {
        urlDedupEnabled: config.FEED_DEDUP_ENABLED,
        minimumOriginalTextLength: config.FEED_DEDUP_MIN_TEXT,
        minimumRelevance: config.FEED_MIN_RELEVANCE,
        decay: FEED_URL_DEDUP_DECAY,
      },
      topicCatalog: capturedPolicy.topicCatalog,
      entries: approvedEntries,
    };
    const manifest = {
      ...manifestPayload,
      snapshotDigest: communityGovManifestDigest(manifestPayload),
    };
    const languages = frequency(publicItems.flatMap((item) => item.displayPost.kind === 'public_post'
      ? item.displayPost.languages ?? ['unlabeled']
      : []));
    const media = frequency(publicItems.flatMap((item) => {
      if (item.displayPost.kind !== 'public_post' || !item.displayPost.media) return ['none'];
      const kinds: string[] = [];
      if (item.displayPost.media.images.length > 0) kinds.push('images');
      if (item.displayPost.media.external) kinds.push('external');
      if (item.displayPost.media.quote) kinds.push('quote');
      if (item.displayPost.media.video) kinds.push('video');
      return kinds.length > 0 ? kinds : ['none'];
    }));
    const completeness = scoreCompletenessRate(scores, snapshot.entries.length);
    const sourceLinksValid = publicItems.every((item) =>
      item.displayPost.kind === 'public_post' && item.displayPost.bskyUrl.startsWith('https://bsky.app/'));
    const gateFailures = communityGovSnapshotGateFailures(corpus.health);
    if (completeness !== 1) gateFailures.push(`score decomposition completeness ${completeness} < 1`);
    if (!sourceLinksValid) gateFailures.push('one or more public source links failed validation');
    const report = {
      schemaVersion: manifest.schemaVersion,
      manifestDigest: manifest.snapshotDigest,
      capturedAt: capturedAt.toISOString(),
      productionEpochId: snapshot.productionEpochId,
      sourceRunId: snapshot.sourceRunId,
      sourceCount: snapshot.entries.length,
      eligibleCount: corpus.health.eligiblePostCount ?? publicItems.length,
      displayableCount: publicItems.length,
      scoreCompletenessRate: completeness,
      uniqueAuthorCount: corpus.health.uniqueAuthors72h,
      topAuthorConcentration: corpus.health.topAuthorConcentration,
      englishTaggedShare: corpus.health.englishTaggedShare ?? 0,
      richMediaShare: corpus.health.richMediaShare ?? 0,
      languageDistribution: languages,
      mediaDistribution: media,
      gateFailures,
      safetyChecklist: {
        appViewVisibilityApplied: true,
        nestedLabelsApplied: true,
        reviewerLanguageGateApplied: true,
        sourceLinksValidated: sourceLinksValid,
        copiedPostTextInManifest: false,
        manualReviewComplete: false,
      },
      warnings: corpus.warnings,
    };
    await Promise.all([
      writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      writeFile(paths.reviewSheet, reviewSheetHtml(manifest, corpus.items), 'utf8'),
    ]);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.gateFailures.length > 0) process.exitCode = 2;
  } finally {
    await Promise.allSettled([db.end(), redis.quit()]);
  }
}

async function buildFrozenEntries(
  snapshot: PublishedFeedSnapshot,
  scores: ReadonlyArray<PostScoreRecord | null>
): Promise<PublishedFeedSnapshot['entries']> {
  const result = await db.query<{
    uri: string;
    author_did: string;
    created_at: Date | string;
    topic_vector: Record<string, number> | null;
    embed_url: string | null;
    text_length: number | string;
  }>(
    `SELECT uri, author_did, created_at, topic_vector, embed_url,
            COALESCE(LENGTH(text), 0) AS text_length
     FROM posts
     WHERE uri = ANY($1::text[])
       AND deleted = FALSE`,
    [snapshot.entries.map((entry) => entry.uri)]
  );
  const rowByUri = new Map(result.rows.map((row) => [row.uri, row]));
  return snapshot.entries.map((entry, index) => {
    const row = rowByUri.get(entry.uri);
    const score = scores[index];
    const scoreRunId = score?.componentDetails?.run_id;
    if (!row || !score || typeof scoreRunId !== 'string' || !scoreRunId.trim()) {
      throw new Error(
        `Published entry at rank ${entry.publishedRank} lacks frozen lineage: post=${String(Boolean(row))}, score=${String(Boolean(score))}, scoreRunId=${String(typeof scoreRunId === 'string' && scoreRunId.trim().length > 0)}`
      );
    }
    return {
      ...entry,
      frozen: {
        authorDid: row.author_did,
        createdAt: new Date(row.created_at).toISOString(),
        topicVector: { ...(row.topic_vector ?? {}) },
        embedUrl: canonicalizeFrozenEmbedUrl(row.embed_url),
        textLength: Number(row.text_length),
        scoreRunId,
        scoreEpochId: score.epochId,
        componentScore: score.totalScore,
        scoredAt: score.scoredAt.toISOString(),
        rawScores: internalRawScoresToShadow(score.components),
      },
    };
  });
}

async function readCapturedPolicy(epochId: number): Promise<{
  signalWeights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  topicCatalog: Array<{
    slug: string;
    name: string;
    description: string | null;
    baselineWeight: number;
  }>;
}> {
  const [epochResult, topicResult] = await Promise.all([
    db.query<{
      recency_weight: number;
      engagement_weight: number;
      bridging_weight: number;
      source_diversity_weight: number;
      relevance_weight: number;
      topic_weights: Record<string, number> | null;
    }>(
      `SELECT recency_weight, engagement_weight, bridging_weight, source_diversity_weight,
              relevance_weight, topic_weights
       FROM governance_epochs
       WHERE id = $1
       LIMIT 1`,
      [epochId]
    ),
    db.query<{ slug: string; name: string; description: string | null }>(
      `SELECT slug, name, description
       FROM topic_catalog
       WHERE is_active = TRUE
       ORDER BY slug`
    ),
  ]);
  const epoch = epochResult.rows[0];
  if (!epoch) throw new Error(`Captured production epoch ${epochId} was not found`);
  if (topicResult.rows.length !== COMMUNITY_GOV_ACTIVE_TOPIC_COUNT) {
    throw new Error(
      `Captured production topic catalog must contain ${COMMUNITY_GOV_ACTIVE_TOPIC_COUNT} active topics; received ${topicResult.rows.length}`
    );
  }
  const signalWeights = {
    recency: Number(epoch.recency_weight),
    engagement: Number(epoch.engagement_weight),
    bridging: Number(epoch.bridging_weight),
    source_diversity: Number(epoch.source_diversity_weight),
    relevance: Number(epoch.relevance_weight),
  };
  const signalSum = Object.values(signalWeights).reduce((sum, value) => sum + value, 0);
  if (Object.values(signalWeights).some((value) => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(signalSum - 1) > 1e-9) {
    throw new Error(`Captured production signal policy is invalid for epoch ${epochId}`);
  }
  const topicCatalog = topicResult.rows.map((topic) => ({
    ...topic,
    baselineWeight: Number(epoch.topic_weights?.[topic.slug] ?? 0.5),
  }));
  if (topicCatalog.some((topic) => !Number.isFinite(topic.baselineWeight) || topic.baselineWeight < 0 || topic.baselineWeight > 1)) {
    throw new Error(`Captured production topic policy is invalid for epoch ${epochId}`);
  }
  return { signalWeights, topicCatalog };
}

function parsePaths(args: string[]): CapturePaths {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('Expected --manifest, --report, and --review-sheet paths');
    values.set(key.slice(2), value);
  }
  const manifest = values.get('manifest');
  const report = values.get('report');
  const reviewSheet = values.get('review-sheet');
  if (!manifest || !report || !reviewSheet) throw new Error('Expected --manifest, --report, and --review-sheet paths');
  return { manifest, report, reviewSheet };
}

function frequency(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function reviewSheetHtml(
  manifest: { feedName: string; capturedAt: string; snapshotDigest: string },
  items: readonly import('../src/demo/types.js').ShadowDemoCorpusItem[]
): string {
  const rows = items.map((item) => {
    const post = item.displayPost;
    if (post.kind !== 'public_post') return '';
    const safeHref = safeBlueskyPostUrl(post.bskyUrl);
    return `<article><h2>#${item.publishedRank ?? '?'} ${escapeHtml(post.authorDisplayName)} <small>@${escapeHtml(post.authorHandle)}</small></h2><p>${escapeHtml(post.text)}</p><p>${safeHref ? `<a href="${escapeHtml(safeHref)}">Open on Bluesky</a>` : 'Bluesky source unavailable'} · ${escapeHtml((post.languages ?? ['unlabeled']).join(', '))} · ${post.media ? 'rich media' : 'text only'}</p><label><input type="checkbox"> Reviewed</label></article>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(manifest.feedName)} review sheet</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#211a16}article{border-top:1px solid #ddd;padding:18px 0}h2{font-size:18px}small{font-weight:400;color:#58606a}p{line-height:1.5}a{color:#b44d1d}</style><h1>${escapeHtml(manifest.feedName)} reviewer snapshot</h1><p>Captured ${escapeHtml(manifest.capturedAt)} · digest <code>${escapeHtml(manifest.snapshotDigest)}</code></p>${rows}</html>`;
}

function safeBlueskyPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'bsky.app' && url.pathname.startsWith('/profile/')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Corgi Commons snapshot capture failed: ${message}\n`);
  process.exitCode = 1;
});

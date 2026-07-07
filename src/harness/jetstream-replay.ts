import { performance } from 'node:perf_hooks';
import { __testJetstreamQueue, type JetstreamMessageProcessResult } from '../ingestion/jetstream.js';
import { buildAtUri, COLLECTIONS, type JetstreamEvent } from '../ingestion/jetstream.types.js';

export type JetstreamReplayOutcome =
  | 'post-inserted'
  | 'post-duplicate-noop'
  | 'post-nsfw-skipped'
  | 'post-media-skipped'
  | 'like-inserted'
  | 'like-duplicate-noop'
  | 'like-untracked-ignored'
  | 'repost-inserted'
  | 'repost-duplicate-noop'
  | 'repost-untracked-ignored'
  | 'follow-inserted'
  | 'follow-duplicate-noop'
  | 'update-ignored'
  | 'non-commit-ignored'
  | 'delete-like-applied'
  | 'delete-repost-applied'
  | 'delete-follow-applied'
  | 'delete-post-applied'
  | 'parse-error'
  | 'handler-error'
  | 'state-mismatch'
  | 'queue-drop';

export interface JetstreamReplayDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface JetstreamReplayFixture {
  id: string;
  expectedOutcome: JetstreamReplayOutcome;
  raw: string;
  cursorUs: number | null;
}

export interface JetstreamReplayState {
  postsTotal: number;
  postsDeleted: number;
  likesTotal: number;
  likesDeleted: number;
  repostsTotal: number;
  repostsDeleted: number;
  followsTotal: number;
  followsDeleted: number;
  engagementRows: number;
  likeCountSum: number;
  repostCountSum: number;
  replyCountSum: number;
  persistedCursorUs: string | null;
}

export interface JetstreamReplayLatencyStats {
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  average: number;
}

export interface JetstreamReplayEventResult {
  fixtureId: string;
  expectedOutcome: JetstreamReplayOutcome;
  observedOutcome: JetstreamReplayOutcome;
  latencyMs: number;
  processResult: JetstreamMessageProcessResult;
}

export interface JetstreamReplaySummary {
  eventCount: number;
  eventMix: Record<string, number>;
  observedOutcomes: Record<string, number>;
  elapsedMs: number;
  eventsPerSecond: number;
  handlerLatencyMs: JetstreamReplayLatencyStats;
  durableStateMutations: number;
  durableStateMutationsPerSecond: number;
  maxInputCursorUs: string | null;
  lastProcessedCursorUs: string | null;
  persistedCursorUs: string | null;
  cursorLagUs: string | null;
  queueDepthMax: number;
  droppedEvents: number;
  duplicateNoops: number;
  untrackedIgnores: number;
  parseErrors: number;
  handlerErrors: number;
  stateMismatches: number;
  outcomeMismatches: number;
  beforeState: JetstreamReplayState;
  afterState: JetstreamReplayState;
  resultsSample: JetstreamReplayEventResult[];
  scoringDelayMs: number | null;
  scoreRows: number | null;
}

interface ReplayStateRow {
  postsTotal: number;
  postsDeleted: number;
  likesTotal: number;
  likesDeleted: number;
  repostsTotal: number;
  repostsDeleted: number;
  followsTotal: number;
  followsDeleted: number;
  engagementRows: number;
  likeCountSum: number;
  repostCountSum: number;
  replyCountSum: number;
  persistedCursorUs: string | null;
}

interface ReplayStateDelta {
  postsTotal: number;
  postsDeleted: number;
  likesTotal: number;
  likesDeleted: number;
  repostsTotal: number;
  repostsDeleted: number;
  followsTotal: number;
  followsDeleted: number;
  engagementRows: number;
  likeCountSum: number;
  repostCountSum: number;
  replyCountSum: number;
}

export interface RunJetstreamReplayOptions {
  db: JetstreamReplayDb;
  eventCount: number;
  startCursorUs: number;
  runScoring: (() => Promise<void>) | null;
}

const ZERO_DELTA: ReplayStateDelta = {
  postsTotal: 0,
  postsDeleted: 0,
  likesTotal: 0,
  likesDeleted: 0,
  repostsTotal: 0,
  repostsDeleted: 0,
  followsTotal: 0,
  followsDeleted: 0,
  engagementRows: 0,
  likeCountSum: 0,
  repostCountSum: 0,
  replyCountSum: 0,
};
const REPLAY_OUTCOME_VALUES: readonly JetstreamReplayOutcome[] = [
  'post-inserted',
  'post-duplicate-noop',
  'post-nsfw-skipped',
  'post-media-skipped',
  'like-inserted',
  'like-duplicate-noop',
  'like-untracked-ignored',
  'repost-inserted',
  'repost-duplicate-noop',
  'repost-untracked-ignored',
  'follow-inserted',
  'follow-duplicate-noop',
  'update-ignored',
  'non-commit-ignored',
  'delete-like-applied',
  'delete-repost-applied',
  'delete-follow-applied',
  'delete-post-applied',
  'parse-error',
  'handler-error',
  'state-mismatch',
  'queue-drop',
];
const REPLAY_OUTCOMES = new Set<string>(REPLAY_OUTCOME_VALUES);
const REPLAY_CURSOR_STRIDE = 100;
const REPLAY_MAX_CURSOR_OFFSET = 19;
let replayInProgress = false;

function roundNumber(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const rank = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  const boundedRank = Math.max(0, Math.min(sortedValues.length - 1, rank));
  return roundNumber(sortedValues[boundedRank], 2);
}

function summarizeLatency(latenciesMs: readonly number[]): JetstreamReplayLatencyStats {
  if (latenciesMs.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, average: 0 };
  }

  const sorted = [...latenciesMs].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    min: roundNumber(sorted[0], 2),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: roundNumber(sorted[sorted.length - 1], 2),
    average: roundNumber(total / sorted.length, 2),
  };
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function eventToRaw(event: JetstreamEvent): string {
  return JSON.stringify(event);
}

function commitEvent(
  did: string,
  timeUs: number,
  operation: 'create' | 'update' | 'delete',
  collection: string,
  rkey: string,
  cid: string | null,
  record: Record<string, unknown> | null
): JetstreamEvent {
  return {
    did,
    time_us: timeUs,
    kind: 'commit',
    commit: {
      rev: `rev-${timeUs}`,
      operation,
      collection,
      rkey,
      ...(cid === null ? {} : { cid }),
      ...(record === null ? {} : { record }),
    },
  };
}

function nonCommitEvent(did: string, timeUs: number): JetstreamEvent {
  return {
    did,
    time_us: timeUs,
    kind: 'identity',
  };
}

function fixture(
  id: string,
  expectedOutcome: JetstreamReplayOutcome,
  event: JetstreamEvent,
  cursorUs: number
): JetstreamReplayFixture {
  return {
    id,
    expectedOutcome,
    raw: eventToRaw(event),
    cursorUs,
  };
}

function fixtureFromRaw(id: string, expectedOutcome: JetstreamReplayOutcome, raw: string): JetstreamReplayFixture {
  return {
    id,
    expectedOutcome,
    raw,
    cursorUs: null,
  };
}

function createReplayCycle(cycle: number, startCursorUs: number, baseCreatedAtMs: number): JetstreamReplayFixture[] {
  const authorDid = `did:plc:corgi-replay-author-${cycle}`;
  const actorDid = `did:plc:corgi-replay-actor-${cycle}`;
  const followedDid = `did:plc:corgi-replay-followed-${cycle}`;
  const postRkey = `post-${cycle}`;
  const likeRkey = `like-${cycle}`;
  const repostRkey = `repost-${cycle}`;
  const followRkey = `follow-${cycle}`;
  const postUri = buildAtUri(authorDid, COLLECTIONS.POST, postRkey);
  const untrackedUri = buildAtUri('did:plc:corgi-replay-untracked', COLLECTIONS.POST, `missing-${cycle}`);
  const createdAt = new Date(baseCreatedAtMs - cycle * 1000).toISOString();
  let offset = 0;
  const nextCursor = (): number => {
    offset += 1;
    return startCursorUs + offset;
  };

  const validPostRecord = {
    text: `Corgi validation post ${cycle} about feed governance, software, community scoring, and transparent moderation.`,
    langs: ['en'],
    createdAt,
  };

  return [
    fixture(
      `${cycle}-post-create`,
      'post-inserted',
      commitEvent(authorDid, nextCursor(), 'create', COLLECTIONS.POST, postRkey, `cid-post-${cycle}`, validPostRecord),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-post-duplicate`,
      'post-duplicate-noop',
      commitEvent(authorDid, nextCursor(), 'create', COLLECTIONS.POST, postRkey, `cid-post-${cycle}`, validPostRecord),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-post-nsfw`,
      'post-nsfw-skipped',
      commitEvent(authorDid, nextCursor(), 'create', COLLECTIONS.POST, `nsfw-${cycle}`, `cid-nsfw-${cycle}`, {
        text: 'Labelled content should not enter the feed.',
        langs: ['en'],
        createdAt,
        labels: { values: [{ val: 'porn' }] },
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-post-media-skip`,
      'post-media-skipped',
      commitEvent(authorDid, nextCursor(), 'create', COLLECTIONS.POST, `media-${cycle}`, `cid-media-${cycle}`, {
        text: '',
        langs: ['en'],
        createdAt,
        embed: { images: [{ alt: '', image: {} }] },
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-like-create`,
      'like-inserted',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.LIKE, likeRkey, `cid-like-${cycle}`, {
        subject: { uri: postUri, cid: `cid-post-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-like-duplicate`,
      'like-duplicate-noop',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.LIKE, likeRkey, `cid-like-${cycle}`, {
        subject: { uri: postUri, cid: `cid-post-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-like-untracked`,
      'like-untracked-ignored',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.LIKE, `like-missing-${cycle}`, `cid-like-missing-${cycle}`, {
        subject: { uri: untrackedUri, cid: `cid-missing-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-repost-create`,
      'repost-inserted',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.REPOST, repostRkey, `cid-repost-${cycle}`, {
        subject: { uri: postUri, cid: `cid-post-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-repost-duplicate`,
      'repost-duplicate-noop',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.REPOST, repostRkey, `cid-repost-${cycle}`, {
        subject: { uri: postUri, cid: `cid-post-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-repost-untracked`,
      'repost-untracked-ignored',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.REPOST, `repost-missing-${cycle}`, `cid-repost-missing-${cycle}`, {
        subject: { uri: untrackedUri, cid: `cid-missing-${cycle}` },
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-follow-create`,
      'follow-inserted',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.FOLLOW, followRkey, `cid-follow-${cycle}`, {
        subject: followedDid,
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-follow-duplicate`,
      'follow-duplicate-noop',
      commitEvent(actorDid, nextCursor(), 'create', COLLECTIONS.FOLLOW, followRkey, `cid-follow-${cycle}`, {
        subject: followedDid,
        createdAt,
      }),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-update-ignore`,
      'update-ignored',
      commitEvent(authorDid, nextCursor(), 'update', COLLECTIONS.POST, postRkey, `cid-post-${cycle}`, validPostRecord),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-non-commit-ignore`,
      'non-commit-ignored',
      nonCommitEvent(authorDid, nextCursor()),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-like-delete`,
      'delete-like-applied',
      commitEvent(actorDid, nextCursor(), 'delete', COLLECTIONS.LIKE, likeRkey, null, null),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-repost-delete`,
      'delete-repost-applied',
      commitEvent(actorDid, nextCursor(), 'delete', COLLECTIONS.REPOST, repostRkey, null, null),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-follow-delete`,
      'delete-follow-applied',
      commitEvent(actorDid, nextCursor(), 'delete', COLLECTIONS.FOLLOW, followRkey, null, null),
      startCursorUs + offset
    ),
    fixture(
      `${cycle}-post-delete`,
      'delete-post-applied',
      commitEvent(authorDid, nextCursor(), 'delete', COLLECTIONS.POST, postRkey, null, null),
      startCursorUs + offset
    ),
    fixtureFromRaw(`${cycle}-parse-error`, 'parse-error', `{"did":"${authorDid}","kind":"commit","time_us":`),
  ];
}

export function createSyntheticJetstreamReplay(eventCount: number, startCursorUs: number): JetstreamReplayFixture[] {
  if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
    throw new RangeError(`eventCount must be a positive integer; received ${eventCount}`);
  }
  if (!Number.isSafeInteger(startCursorUs) || startCursorUs < 1) {
    throw new RangeError(`startCursorUs must be a positive integer; received ${startCursorUs}`);
  }
  const cycleCount = Math.ceil(eventCount / REPLAY_MAX_CURSOR_OFFSET);
  const maxGeneratedCursorUs = startCursorUs + Math.max(cycleCount - 1, 0) * REPLAY_CURSOR_STRIDE + REPLAY_MAX_CURSOR_OFFSET;
  if (!Number.isSafeInteger(maxGeneratedCursorUs)) {
    throw new RangeError(
      `generated cursor_us would exceed Number.MAX_SAFE_INTEGER; eventCount=${eventCount}, startCursorUs=${startCursorUs}`
    );
  }

  const fixtures: JetstreamReplayFixture[] = [];
  const baseCreatedAtMs = Date.now();
  let cycle = 0;
  while (fixtures.length < eventCount) {
    fixtures.push(...createReplayCycle(cycle, startCursorUs + cycle * REPLAY_CURSOR_STRIDE, baseCreatedAtMs));
    cycle += 1;
  }
  return fixtures.slice(0, eventCount);
}

export async function readJetstreamReplayState(db: JetstreamReplayDb): Promise<JetstreamReplayState> {
  const result = await db.query<ReplayStateRow>(
    `SELECT
       (SELECT COUNT(*)::int FROM posts) AS "postsTotal",
       (SELECT COUNT(*)::int FROM posts WHERE deleted = TRUE) AS "postsDeleted",
       (SELECT COUNT(*)::int FROM likes) AS "likesTotal",
       (SELECT COUNT(*)::int FROM likes WHERE deleted = TRUE) AS "likesDeleted",
       (SELECT COUNT(*)::int FROM reposts) AS "repostsTotal",
       (SELECT COUNT(*)::int FROM reposts WHERE deleted = TRUE) AS "repostsDeleted",
       (SELECT COUNT(*)::int FROM follows) AS "followsTotal",
       (SELECT COUNT(*)::int FROM follows WHERE deleted = TRUE) AS "followsDeleted",
       (SELECT COUNT(*)::int FROM post_engagement) AS "engagementRows",
       (SELECT COALESCE(SUM(like_count), 0)::int FROM post_engagement) AS "likeCountSum",
       (SELECT COALESCE(SUM(repost_count), 0)::int FROM post_engagement) AS "repostCountSum",
       (SELECT COALESCE(SUM(reply_count), 0)::int FROM post_engagement) AS "replyCountSum",
       (SELECT cursor_us::text FROM jetstream_cursor WHERE id = 1) AS "persistedCursorUs"`
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('replay state query returned no rows');
  }
  return row;
}

async function readScoreRows(db: JetstreamReplayDb): Promise<number> {
  const result = await db.query<{ scoreRows: number }>('SELECT COUNT(*)::int AS "scoreRows" FROM post_scores');
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('score row query returned no rows');
  }
  return row.scoreRows;
}

function stateDelta(before: JetstreamReplayState, after: JetstreamReplayState): ReplayStateDelta {
  return {
    postsTotal: after.postsTotal - before.postsTotal,
    postsDeleted: after.postsDeleted - before.postsDeleted,
    likesTotal: after.likesTotal - before.likesTotal,
    likesDeleted: after.likesDeleted - before.likesDeleted,
    repostsTotal: after.repostsTotal - before.repostsTotal,
    repostsDeleted: after.repostsDeleted - before.repostsDeleted,
    followsTotal: after.followsTotal - before.followsTotal,
    followsDeleted: after.followsDeleted - before.followsDeleted,
    engagementRows: after.engagementRows - before.engagementRows,
    likeCountSum: after.likeCountSum - before.likeCountSum,
    repostCountSum: after.repostCountSum - before.repostCountSum,
    replyCountSum: after.replyCountSum - before.replyCountSum,
  };
}

function expectedDelta(outcome: JetstreamReplayOutcome): ReplayStateDelta {
  switch (outcome) {
    case 'post-inserted':
      return { ...ZERO_DELTA, postsTotal: 1, engagementRows: 1 };
    case 'like-inserted':
      return { ...ZERO_DELTA, likesTotal: 1, likeCountSum: 1 };
    case 'repost-inserted':
      return { ...ZERO_DELTA, repostsTotal: 1, repostCountSum: 1 };
    case 'follow-inserted':
      return { ...ZERO_DELTA, followsTotal: 1 };
    case 'delete-like-applied':
      return { ...ZERO_DELTA, likesDeleted: 1, likeCountSum: -1 };
    case 'delete-repost-applied':
      return { ...ZERO_DELTA, repostsDeleted: 1, repostCountSum: -1 };
    case 'delete-follow-applied':
      return { ...ZERO_DELTA, followsDeleted: 1 };
    case 'delete-post-applied':
      return { ...ZERO_DELTA, postsDeleted: 1 };
    default:
      return ZERO_DELTA;
  }
}

function deltasMatch(actual: ReplayStateDelta, expected: ReplayStateDelta): boolean {
  return (
    actual.postsTotal === expected.postsTotal &&
    actual.postsDeleted === expected.postsDeleted &&
    actual.likesTotal === expected.likesTotal &&
    actual.likesDeleted === expected.likesDeleted &&
    actual.repostsTotal === expected.repostsTotal &&
    actual.repostsDeleted === expected.repostsDeleted &&
    actual.followsTotal === expected.followsTotal &&
    actual.followsDeleted === expected.followsDeleted &&
    actual.engagementRows === expected.engagementRows &&
    actual.likeCountSum === expected.likeCountSum &&
    actual.repostCountSum === expected.repostCountSum &&
    actual.replyCountSum === expected.replyCountSum
  );
}

function countStateMutations(delta: ReplayStateDelta): number {
  return (
    Math.max(delta.postsTotal, 0) +
    Math.max(delta.postsDeleted, 0) +
    Math.max(delta.likesTotal, 0) +
    Math.max(delta.likesDeleted, 0) +
    Math.max(delta.repostsTotal, 0) +
    Math.max(delta.repostsDeleted, 0) +
    Math.max(delta.followsTotal, 0) +
    Math.max(delta.followsDeleted, 0) +
    Math.abs(delta.engagementRows) +
    Math.abs(delta.likeCountSum) +
    Math.abs(delta.repostCountSum) +
    Math.abs(delta.replyCountSum)
  );
}

function addDelta(left: ReplayStateDelta, right: ReplayStateDelta): ReplayStateDelta {
  return {
    postsTotal: left.postsTotal + right.postsTotal,
    postsDeleted: left.postsDeleted + right.postsDeleted,
    likesTotal: left.likesTotal + right.likesTotal,
    likesDeleted: left.likesDeleted + right.likesDeleted,
    repostsTotal: left.repostsTotal + right.repostsTotal,
    repostsDeleted: left.repostsDeleted + right.repostsDeleted,
    followsTotal: left.followsTotal + right.followsTotal,
    followsDeleted: left.followsDeleted + right.followsDeleted,
    engagementRows: left.engagementRows + right.engagementRows,
    likeCountSum: left.likeCountSum + right.likeCountSum,
    repostCountSum: left.repostCountSum + right.repostCountSum,
    replyCountSum: left.replyCountSum + right.replyCountSum,
  };
}

function isReplayOutcome(value: string): value is JetstreamReplayOutcome {
  return REPLAY_OUTCOMES.has(value);
}

function classifyProcessOutcome(processResult: JetstreamMessageProcessResult): JetstreamReplayOutcome {
  if (processResult.dropped) {
    return 'queue-drop';
  }
  if (!processResult.parsed) {
    return 'parse-error';
  }
  if (!processResult.processed) {
    return 'handler-error';
  }
  const ingestionOutcome = processResult.ingestionOutcome;
  if (ingestionOutcome === null) {
    return 'state-mismatch';
  }
  return isReplayOutcome(ingestionOutcome) ? ingestionOutcome : 'state-mismatch';
}

function computeCursorLagUs(maxInputCursorUs: string | null, persistedCursorUs: string | null): string | null {
  if (maxInputCursorUs === null || persistedCursorUs === null) {
    return null;
  }
  return (BigInt(maxInputCursorUs) - BigInt(persistedCursorUs)).toString();
}

export async function runJetstreamReplay(options: RunJetstreamReplayOptions): Promise<JetstreamReplaySummary> {
  if (replayInProgress) {
    throw new Error('runJetstreamReplay cannot run concurrently because it uses shared Jetstream test queue state');
  }

  replayInProgress = true;
  try {
    const fixtures = createSyntheticJetstreamReplay(options.eventCount, options.startCursorUs);
    __testJetstreamQueue.reset();

    const beforeState = await readJetstreamReplayState(options.db);
    const eventMix: Record<string, number> = {};
    const observedOutcomes: Record<string, number> = {};
    const results: JetstreamReplayEventResult[] = [];
    const latenciesMs: number[] = [];
    let queueDepthMax = 0;
    let outcomeMismatches = 0;
    let maxInputCursorUs: string | null = null;
    let lastProcessedCursorUs: string | null = null;
    let handlerElapsedMs = 0;
    let expectedReplayDelta = ZERO_DELTA;
    const startedAtMs = performance.now();

    for (const replayFixture of fixtures) {
      increment(eventMix, replayFixture.expectedOutcome);
      if (replayFixture.cursorUs !== null) {
        maxInputCursorUs =
          maxInputCursorUs === null
            ? String(replayFixture.cursorUs)
            : BigInt(replayFixture.cursorUs) > BigInt(maxInputCursorUs)
              ? String(replayFixture.cursorUs)
              : maxInputCursorUs;
      }

      const eventStartedAtMs = performance.now();
      const processResult = await __testJetstreamQueue.processMessage(Buffer.from(replayFixture.raw, 'utf8'));
      const latencyMs = roundNumber(performance.now() - eventStartedAtMs, 2);
      handlerElapsedMs += latencyMs;
      queueDepthMax = Math.max(queueDepthMax, processResult.queueState.queued);
      if (processResult.cursorUs !== null) {
        lastProcessedCursorUs = processResult.cursorUs;
      }

      const observedOutcome = classifyProcessOutcome(processResult);
      if (observedOutcome !== replayFixture.expectedOutcome) {
        outcomeMismatches += 1;
      }
      expectedReplayDelta = addDelta(expectedReplayDelta, expectedDelta(replayFixture.expectedOutcome));
      increment(observedOutcomes, observedOutcome);
      latenciesMs.push(latencyMs);
      results.push({
        fixtureId: replayFixture.id,
        expectedOutcome: replayFixture.expectedOutcome,
        observedOutcome,
        latencyMs,
        processResult,
      });
    }

    const replayElapsedMs = performance.now() - startedAtMs;
    let scoringDelayMs: number | null = null;
    let scoreRows: number | null = null;
    if (options.runScoring !== null) {
      const scoringStartedAtMs = performance.now();
      await options.runScoring();
      scoringDelayMs = roundNumber(performance.now() - scoringStartedAtMs, 2);
      scoreRows = await readScoreRows(options.db);
    }

    const afterState = await readJetstreamReplayState(options.db);
    const actualReplayDelta = stateDelta(beforeState, afterState);
    const durableStateMutations = countStateMutations(actualReplayDelta);
    const stateMismatches = deltasMatch(actualReplayDelta, expectedReplayDelta) ? 0 : 1;
    if (stateMismatches > 0) {
      increment(observedOutcomes, 'state-mismatch');
      outcomeMismatches += stateMismatches;
    }
    const persistedCursorUs = afterState.persistedCursorUs;
    const handlerSeconds = Math.max(handlerElapsedMs / 1000, 0.001);

    return {
      eventCount: fixtures.length,
      eventMix,
      observedOutcomes,
      elapsedMs: roundNumber(replayElapsedMs, 2),
      eventsPerSecond: roundNumber(fixtures.length / handlerSeconds, 2),
      handlerLatencyMs: summarizeLatency(latenciesMs),
      durableStateMutations,
      durableStateMutationsPerSecond: roundNumber(durableStateMutations / handlerSeconds, 2),
      maxInputCursorUs,
      lastProcessedCursorUs,
      persistedCursorUs,
      cursorLagUs: computeCursorLagUs(maxInputCursorUs, persistedCursorUs),
      queueDepthMax,
      droppedEvents: observedOutcomes['queue-drop'] ?? 0,
      duplicateNoops: (observedOutcomes['post-duplicate-noop'] ?? 0) +
        (observedOutcomes['like-duplicate-noop'] ?? 0) +
        (observedOutcomes['repost-duplicate-noop'] ?? 0) +
        (observedOutcomes['follow-duplicate-noop'] ?? 0),
      untrackedIgnores: (observedOutcomes['like-untracked-ignored'] ?? 0) +
        (observedOutcomes['repost-untracked-ignored'] ?? 0),
      parseErrors: observedOutcomes['parse-error'] ?? 0,
      handlerErrors: observedOutcomes['handler-error'] ?? 0,
      stateMismatches,
      outcomeMismatches,
      beforeState,
      afterState,
      resultsSample: results.slice(0, 50),
      scoringDelayMs,
      scoreRows,
    };
  } finally {
    __testJetstreamQueue.reset();
    replayInProgress = false;
  }
}

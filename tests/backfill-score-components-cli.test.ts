/**
 * CLI regression tests for scripts/backfill-score-components.ts.
 *
 * The DATABASE_URL guard is safety-critical: if it regresses, the backfill
 * could target an unintended local Postgres (the default) and write into the
 * wrong database. These tests lock that guard in.
 *
 * Pattern: spawnSync invokes the script in a controlled subshell with
 * DATABASE_URL absent or set to a sentinel; assert exit code, stderr, and
 * that we exit before any DB connection attempt.
 *
 * Per CodeRabbit feedback on PR #222 (review at 2026-05-26T19:31:45Z).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectWideRows } from '../scripts/backfill-score-components.ts';

const SCRIPT = path.resolve('scripts', 'backfill-score-components.ts');
const TSX_LOADER = path.resolve('node_modules', 'tsx', 'dist', 'loader.mjs');
const SENTINEL = 'postgresql://sentinel-user:sentinel-pass@sentinel-host:6543/sentinel-db';

/** Minimal well-formed WideRow fixture (the shape of a post_scores row this
 * script selects), overridable per-field for individual test cases. */
function buildWideScoreRow(overrides: Partial<Parameters<typeof projectWideRows>[0][number]> = {}) {
  return {
    post_uri: 'at://did:plc:test/app.bsky.feed.post/backfill-1',
    epoch_id: 1,
    recency_score: 0.5,
    engagement_score: 0.5,
    bridging_score: 0.5,
    source_diversity_score: 0.5,
    relevance_score: 0.5,
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    recency_weighted: 0.1,
    engagement_weighted: 0.1,
    bridging_weighted: 0.1,
    source_diversity_weighted: 0.1,
    relevance_weighted: 0.1,
    scored_at: '2026-07-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}
const UNSAFE_INTEGER = '9007199254740993';

/**
 * Guard against a subprocess that never actually spawned (tsx not found,
 * PATH issue, etc.). Without this, a `result.status === null` would let
 * negative assertions like `not.toBe(2)` false-pass.
 */
function assertSpawnCompleted(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBeNull();
}

function runScript(
  args: string[],
  envOverrides: Record<string, string | undefined>
): SpawnSyncReturns<string> {
  const env = { ...process.env, NODE_ENV: 'test', ...envOverrides };
  // Explicitly delete keys whose override value is undefined so the spawned
  // process sees the var as absent, not as the literal string "undefined".
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
  }
  // Run from /tmp so the script's `dotenv.config()` does not find a .env in
  // the repo cwd and silently re-populate DATABASE_URL from it. tsx and the
  // script use absolute paths, so cwd is otherwise irrelevant.
  return spawnSync(process.execPath, ['--import', TSX_LOADER, SCRIPT, ...args], {
    cwd: '/tmp',
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('backfill-score-components CLI: DATABASE_URL guard', () => {
  it('exits with code 2 and a clear error when DATABASE_URL is unset', () => {
    const result = runScript(['--dry-run'], { DATABASE_URL: undefined });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL is required/);
    expect(result.stdout).not.toMatch(/Connecting to/);
  });

  it('exits with code 2 when DATABASE_URL is empty string', () => {
    const result = runScript(['--dry-run'], { DATABASE_URL: '' });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL is required/);
  });

  it('advances past the env check when DATABASE_URL is set (sentinel value)', () => {
    // The sentinel host:port is unreachable, so we expect the script to advance
    // past the env check and fail later at the actual connection step. The
    // signal we care about is: exit code is NOT 2 (i.e. not the env-check exit),
    // and stderr does NOT mention the env-check error.
    const result = runScript(['--dry-run'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.stderr).not.toMatch(/DATABASE_URL is required/);
    // Either a successful run or a connection-time failure is fine; both are
    // strictly after the env check.
    expect(result.status).not.toBe(2);
  });
});

describe('backfill-score-components CLI: argument validation', () => {
  it('rejects --batch-size with a non-numeric value', () => {
    const result = runScript(['--batch-size', 'foo'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --batch-size with a negative value', () => {
    const result = runScript(['--batch-size', '-5'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --batch-size with a zero value (min is 1)', () => {
    const result = runScript(['--batch-size', '0'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --batch-size with no following value (bare flag)', () => {
    // `['--batch-size']` — the flag is present but has no value. Today the
    // parser falls through because the `args[i + 1]` guard short-circuits.
    // That's silently equivalent to "use the default" which is the wrong
    // behavior for an explicit flag — the user is signalling intent.
    const result = runScript(['--batch-size'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--batch-size/);
  });

  it('rejects --batch-size with an empty string value', () => {
    // `['--batch-size', '']` — explicit empty value, distinct from missing.
    // Empty parses as NaN and must surface a clear error.
    const result = runScript(['--batch-size', ''], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--batch-size/);
  });

  it('rejects --batch-size with an unsafe integer value', () => {
    const result = runScript(['--batch-size', UNSAFE_INTEGER], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --epoch-id with an unsafe integer value', () => {
    const result = runScript(['--epoch-id', UNSAFE_INTEGER], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --epoch-id/);
  });

  it('rejects --limit with an unsafe integer value', () => {
    const result = runScript(['--limit', UNSAFE_INTEGER], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --limit/);
  });

  it('rejects an unknown flag', () => {
    const result = runScript(['--unknown-flag'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown argument/);
  });
});

describe('backfill-score-components: projectWideRows (PROJ-917 created_at sourcing)', () => {
  it('projects a single wide row into one component row per registered component', () => {
    const row = buildWideScoreRow();
    const projected = projectWideRows([row]);

    expect(projected).toHaveLength(5);
    expect(new Set(projected.map((p) => p.component_key))).toEqual(
      new Set(['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'])
    );
    for (const component of projected) {
      expect(component.post_uri).toBe(row.post_uri);
      expect(component.created_at).toBe(row.created_at);
    }
  });

  it('keeps each row created_at independent for duplicate post_uri across different created_at (dry-run backfill case)', () => {
    // This is the scenario the posts-JOIN + COALESCE approach could mis-key:
    // two post_scores rows sharing a post_uri (e.g. the same URI replayed
    // into two partitions with different created_at, per the migration
    // 026/027 uniqueness review threads) must each keep their OWN
    // created_at on every projected component — never collapsed onto one
    // value or cross-attributed to the other row.
    const older = buildWideScoreRow({
      post_uri: 'at://did:plc:test/app.bsky.feed.post/dup-uri',
      created_at: '2026-05-01T00:00:00.000Z',
      recency_score: 0.1,
    });
    const newer = buildWideScoreRow({
      post_uri: 'at://did:plc:test/app.bsky.feed.post/dup-uri',
      created_at: '2026-06-15T00:00:00.000Z',
      recency_score: 0.9,
    });

    const projected = projectWideRows([older, newer]);

    // No fan-out / no dropped rows: 2 wide rows × 5 components = 10.
    expect(projected).toHaveLength(10);

    const olderComponents = projected.filter((p) => p.created_at === older.created_at);
    const newerComponents = projected.filter((p) => p.created_at === newer.created_at);
    expect(olderComponents).toHaveLength(5);
    expect(newerComponents).toHaveLength(5);

    // Each group's raw values must trace back to its own source row, not the
    // other row's — this is exactly what a mis-keyed JOIN could scramble.
    const olderRecency = olderComponents.find((p) => p.component_key === 'recency');
    const newerRecency = newerComponents.find((p) => p.component_key === 'recency');
    expect(olderRecency?.raw).toBe(0.1);
    expect(newerRecency?.raw).toBe(0.9);
  });

  it('returns an empty array for an empty input batch', () => {
    expect(projectWideRows([])).toEqual([]);
  });
});

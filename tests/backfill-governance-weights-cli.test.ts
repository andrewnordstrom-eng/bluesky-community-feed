/**
 * CLI regression tests for scripts/backfill-governance-weights.ts.
 *
 * The DATABASE_URL guard is safety-critical: if it regresses, the backfill
 * could target an unintended local Postgres (the default) and write into the
 * wrong database. These tests lock that guard in.
 *
 * Pattern: spawnSync invokes the script in a controlled subshell with
 * DATABASE_URL absent or set to a sentinel; assert exit code, stderr, and
 * that we exit before any DB connection attempt.
 *
 * Per CodeRabbit feedback on PR #223 (review at 2026-05-26T19:35:13Z).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('scripts', 'backfill-governance-weights.ts');
const TSX_LOADER = path.resolve('node_modules', 'tsx', 'dist', 'loader.mjs');
const SENTINEL = 'postgresql://sentinel-user:sentinel-pass@sentinel-host:6543/sentinel-db';

/**
 * Guard against a subprocess that never actually spawned (tsx not found,
 * PATH issue, etc.). Without this, a `result.status === null` would let
 * negative assertions like `not.toBe(2)` false-pass.
 */
function assertSpawnCompleted(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBeNull();
}

function runScript(args: string[], envOverrides: Record<string, string | undefined>) {
  const env = { ...process.env, NODE_ENV: 'test', ...envOverrides };
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

describe('backfill-governance-weights CLI: DATABASE_URL guard', () => {
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
    const result = runScript(['--dry-run'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.stderr).not.toMatch(/DATABASE_URL is required/);
    expect(result.status).not.toBe(2);
  });
});

describe('backfill-governance-weights CLI: argument validation', () => {
  it('rejects --batch-size with a non-numeric value', () => {
    const result = runScript(['--batch-size', 'foo'], { DATABASE_URL: SENTINEL });
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
    const result = runScript(['--batch-size'], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--batch-size/);
  });

  it('rejects --batch-size with an empty string value', () => {
    const result = runScript(['--batch-size', ''], { DATABASE_URL: SENTINEL });
    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--batch-size/);
  });

  it('rejects --limit with a non-positive value', () => {
    const result = runScript(['--limit', '0'], { DATABASE_URL: SENTINEL });
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

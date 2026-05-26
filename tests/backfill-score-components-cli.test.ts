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
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('scripts', 'backfill-score-components.ts');
const TSX = path.resolve('node_modules', '.bin', 'tsx');
const SENTINEL = 'postgresql://sentinel-user:sentinel-pass@sentinel-host:6543/sentinel-db';

function runScript(args: string[], envOverrides: Record<string, string | undefined>) {
  const env = { ...process.env, ...envOverrides };
  // Explicitly delete keys whose override value is undefined so the spawned
  // process sees the var as absent, not as the literal string "undefined".
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
  }
  // Run from /tmp so the script's `dotenv.config()` does not find a .env in
  // the repo cwd and silently re-populate DATABASE_URL from it. tsx and the
  // script use absolute paths, so cwd is otherwise irrelevant.
  return spawnSync(TSX, [SCRIPT, ...args], {
    cwd: '/tmp',
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('backfill-score-components CLI: DATABASE_URL guard', () => {
  it('exits with code 2 and a clear error when DATABASE_URL is unset', () => {
    const result = runScript(['--dry-run'], { DATABASE_URL: undefined });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL is required/);
    expect(result.stdout).not.toMatch(/Connecting to/);
  });

  it('exits with code 2 when DATABASE_URL is empty string', () => {
    const result = runScript(['--dry-run'], { DATABASE_URL: '' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL is required/);
  });

  it('advances past the env check when DATABASE_URL is set (sentinel value)', () => {
    // The sentinel host:port is unreachable, so we expect the script to advance
    // past the env check and fail later at the actual connection step. The
    // signal we care about is: exit code is NOT 2 (i.e. not the env-check exit),
    // and stderr does NOT mention the env-check error.
    const result = runScript(['--dry-run'], { DATABASE_URL: SENTINEL });
    expect(result.stderr).not.toMatch(/DATABASE_URL is required/);
    // Either a successful run or a connection-time failure is fine; both are
    // strictly after the env check.
    expect(result.status === 2).toBe(false);
  });
});

describe('backfill-score-components CLI: argument validation', () => {
  it('rejects --batch-size with a non-numeric value', () => {
    const result = runScript(['--batch-size', 'foo'], { DATABASE_URL: SENTINEL });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --batch-size with a negative value', () => {
    const result = runScript(['--batch-size', '-5'], { DATABASE_URL: SENTINEL });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects --batch-size with a zero value (min is 1)', () => {
    const result = runScript(['--batch-size', '0'], { DATABASE_URL: SENTINEL });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid value for --batch-size/);
  });

  it('rejects an unknown flag', () => {
    const result = runScript(['--unknown-flag'], { DATABASE_URL: SENTINEL });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown argument/);
  });
});

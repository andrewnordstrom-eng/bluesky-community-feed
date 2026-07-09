import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 30_000;
const TSX_LOADER = path.resolve('node_modules', 'tsx', 'dist', 'loader.mjs');

async function runVoteLoadCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(process.execPath, ['--import', TSX_LOADER, 'scripts/vote-load.ts', ...args], {
    cwd: process.cwd(),
    timeout: 30_000,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

describe('vote-load CLI', () => {
  it.each([
    ['unsafe valid requests', ['--dry-run', '--valid-requests', '9007199254740992']],
    ['oversized valid requests', ['--dry-run', '--valid-requests', '100001']],
    ['oversized users', ['--dry-run', '--valid-requests', '10000', '--users', '10001']],
    ['oversized connections', ['--dry-run', '--valid-requests', '2000', '--connections', '1001']],
    ['connections above valid requests', ['--dry-run', '--valid-requests', '10', '--users', '1', '--connections', '11']],
    ['missing flag value', ['--dry-run', '--valid-requests']],
    ['zero valid requests', ['--dry-run', '--valid-requests', '0']],
    ['negative valid requests', ['--dry-run', '--valid-requests', '-5']],
    ['non-numeric valid requests', ['--dry-run', '--valid-requests', 'abc']],
    ['unknown flag', ['--dry-run', '--definitely-not-real']],
    ['stray positional argument', ['--dry-run', 'positional']],
  ])('rejects %s before allocating load inputs', async (_label, args) => {
    await expect(runVoteLoadCli(args)).rejects.toMatchObject({
      stderr: expect.stringMatching(/--valid-requests|--users|--connections|connections|Unknown/),
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('rejects a value flag followed immediately by another flag', async () => {
    await expect(runVoteLoadCli(['--dry-run', '--valid-requests', '--users', '100'])).rejects.toMatchObject({
      stderr: expect.stringContaining('--valid-requests requires a value'),
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('accepts documented upper-bound dry-run arguments', async () => {
    const artifactsRoot = await mkdtemp(path.join(tmpdir(), 'corgi-vote-load-cli-'));
    const result = await runVoteLoadCli([
      '--dry-run',
      '--valid-requests',
      '100000',
      '--users',
      '10000',
      '--connections',
      '1000',
      '--artifacts-root',
      artifactsRoot,
    ]);

    const parsed = JSON.parse(result.stdout) as {
      validRequests: number;
      users: number;
      connections: number;
      dbPoolMax: number;
      runDirectory: string;
    };
    expect(parsed.validRequests).toBe(100_000);
    expect(parsed.users).toBe(10_000);
    expect(parsed.connections).toBe(1000);
    expect(parsed.dbPoolMax).toBe(1010);
    expect(parsed.runDirectory.startsWith(artifactsRoot)).toBe(true);
    expect(result.stderr).toBe('');
  }, CLI_TEST_TIMEOUT_MS);

  it('reports database pool headroom for the default load scenario', async () => {
    const artifactsRoot = await mkdtemp(path.join(tmpdir(), 'corgi-vote-load-cli-'));
    const result = await runVoteLoadCli(['--dry-run', '--artifacts-root', artifactsRoot]);

    const parsed = JSON.parse(result.stdout) as {
      connections: number;
      dbPoolMax: number;
    };
    expect(parsed.connections).toBe(100);
    expect(parsed.dbPoolMax).toBe(110);
    expect(result.stderr).toBe('');
  }, CLI_TEST_TIMEOUT_MS);
});

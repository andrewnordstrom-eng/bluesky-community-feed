import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 30_000;

async function runMemoryCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', 'scripts/memory-isolated-stress.ts', ...args],
    {
      cwd: process.cwd(),
      timeout: 30_000,
    }
  );
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

describe('memory-isolated CLI', () => {
  it.each([
    ['stray positional argument', ['--dry-run', 'dry-run'], /Unknown positional argument/],
    ['missing runs value', ['--dry-run', '--runs'], /--runs requires a value/],
    ['empty inline runs value', ['--dry-run', '--runs='], /--runs requires a value/],
    ['unsafe amount', ['--dry-run', '--amount', '9007199254740992'], /--amount must be a positive integer/],
    ['zero runs', ['--dry-run', '--runs', '0'], /--runs must be a positive integer/],
    ['negative connections', ['--dry-run', '--connections', '-1'], /--connections must be a positive integer/],
    ['oversized runs', ['--dry-run', '--runs', '51'], /--runs must be <= 50/],
    ['oversized amount', ['--dry-run', '--amount', '100001'], /--amount must be <= 100000/],
    ['oversized connections', ['--dry-run', '--connections', '1001'], /--connections must be <= 1000/],
  ])('rejects %s before starting targets', async (_label, args, errorPattern) => {
    await expect(runMemoryCli(args)).rejects.toMatchObject({
      stderr: expect.stringMatching(errorPattern),
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('accepts documented upper-bound dry-run arguments', async () => {
    const artifactsRoot = await mkdtemp(path.join(tmpdir(), 'corgi-memory-cli-'));

    const result = await runMemoryCli([
      '--dry-run',
      '--runs',
      '50',
      '--amount',
      '100000',
      '--connections',
      '1000',
      '--artifacts-root',
      artifactsRoot,
    ]);

    const parsed = JSON.parse(result.stdout) as {
      runs: number;
      amount: number;
      connections: number;
      runDirectory: string;
    };
    expect(parsed.runs).toBe(50);
    expect(parsed.amount).toBe(100_000);
    expect(parsed.connections).toBe(1000);
    expect(parsed.runDirectory.startsWith(artifactsRoot)).toBe(true);
    expect(result.stderr).toBe('');
  }, CLI_TEST_TIMEOUT_MS);
});

import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runMigrationsMock, pgStopMock, redisStopMock } = vi.hoisted(() => ({
  runMigrationsMock: vi.fn(),
  pgStopMock: vi.fn(),
  redisStopMock: vi.fn(),
}));

vi.mock('../scripts/migrate.js', () => ({
  runMigrations: runMigrationsMock,
}));

vi.mock('../src/harness/prod-guard.js', () => ({
  assertEphemeralTarget: vi.fn(),
}));

vi.mock('@testcontainers/postgresql', () => ({
  PostgreSqlContainer: class {
    constructor(_image: string) {}

    async start(): Promise<{ getConnectionUri: () => string; stop: () => Promise<void> }> {
      return {
        getConnectionUri: () => 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
        stop: pgStopMock,
      };
    }
  },
}));

vi.mock('@testcontainers/redis', () => ({
  RedisContainer: class {
    constructor(_image: string) {}

    async start(): Promise<{ getConnectionUrl: () => string; stop: () => Promise<void> }> {
      return {
        getConnectionUrl: () => 'redis://127.0.0.1:6379',
        stop: redisStopMock,
      };
    }
  },
}));

const execFileAsync = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 30_000;
const LAB_ENV_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'CORGI_SIM_ALLOW',
  'NODE_ENV',
  'LOG_LEVEL',
  'FEEDGEN_SERVICE_DID',
  'FEEDGEN_PUBLISHER_DID',
  'FEEDGEN_HOSTNAME',
  'JETSTREAM_URL',
  'JETSTREAM_FALLBACK_URL',
  'JETSTREAM_COLLECTIONS',
  'BSKY_IDENTIFIER',
  'BSKY_APP_PASSWORD',
  'RATE_LIMIT_ENABLED',
] as const;

async function runMemoryCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', 'scripts/memory-isolated-stress.ts', ...args],
    {
      cwd: process.cwd(),
      timeout: CLI_TEST_TIMEOUT_MS,
    }
  );
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

function snapshotLabEnv(): Map<(typeof LAB_ENV_NAMES)[number], string | undefined> {
  const previousEnv = new Map<(typeof LAB_ENV_NAMES)[number], string | undefined>();
  for (const envName of LAB_ENV_NAMES) {
    previousEnv.set(envName, process.env[envName]);
  }
  return previousEnv;
}

function restoreLabEnv(previousEnv: Map<(typeof LAB_ENV_NAMES)[number], string | undefined>): void {
  for (const [envName, envValue] of previousEnv.entries()) {
    if (envValue === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = envValue;
    }
  }
}

describe('memory-isolated CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runMigrationsMock.mockReset();
    pgStopMock.mockReset();
    redisStopMock.mockReset();
  });

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

  it('preserves the startup error when cleanup also fails', async () => {
    const previousEnv = snapshotLabEnv();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runMigrationsMock.mockRejectedValueOnce(new Error('migration exploded'));
    pgStopMock.mockRejectedValueOnce(new Error('postgres stop exploded'));
    redisStopMock.mockRejectedValueOnce(new Error('redis stop exploded'));

    try {
      const { runMemory } = await import('../scripts/memory-isolated-stress.ts');
      await expect(
        runMemory({
          dryRun: false,
          ephemeral: true,
          diagnostic: false,
          heapSnapshots: false,
          prodParity: false,
          runs: 1,
          amount: 1,
          connections: 1,
          artifactsRoot: tmpdir(),
        })
      ).rejects.toThrow('failed to start ephemeral memory target: migration exploded');

      expect(pgStopMock).toHaveBeenCalledTimes(1);
      expect(redisStopMock).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to clean up memory-stress containers after startup error')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop one or more memory-stress containers')
      );
    } finally {
      restoreLabEnv(previousEnv);
    }
  }, CLI_TEST_TIMEOUT_MS);

  it('preserves the startup error when one cleanup stop fails', async () => {
    const previousEnv = snapshotLabEnv();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runMigrationsMock.mockRejectedValueOnce(new Error('migration exploded'));
    pgStopMock.mockRejectedValueOnce(new Error('postgres stop exploded'));
    redisStopMock.mockResolvedValueOnce(undefined);

    try {
      const { runMemory } = await import('../scripts/memory-isolated-stress.ts');
      await expect(
        runMemory({
          dryRun: false,
          ephemeral: true,
          diagnostic: false,
          heapSnapshots: false,
          prodParity: false,
          runs: 1,
          amount: 1,
          connections: 1,
          artifactsRoot: tmpdir(),
        })
      ).rejects.toThrow('failed to start ephemeral memory target: migration exploded');

      expect(pgStopMock).toHaveBeenCalledTimes(1);
      expect(redisStopMock).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to clean up memory-stress containers after startup error')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop one or more memory-stress containers')
      );
    } finally {
      restoreLabEnv(previousEnv);
    }
  }, CLI_TEST_TIMEOUT_MS);

  it('preserves the startup error without warning when cleanup succeeds', async () => {
    const previousEnv = snapshotLabEnv();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runMigrationsMock.mockRejectedValueOnce(new Error('migration exploded'));
    pgStopMock.mockResolvedValueOnce(undefined);
    redisStopMock.mockResolvedValueOnce(undefined);

    try {
      const { runMemory } = await import('../scripts/memory-isolated-stress.ts');
      await expect(
        runMemory({
          dryRun: false,
          ephemeral: true,
          diagnostic: false,
          heapSnapshots: false,
          prodParity: false,
          runs: 1,
          amount: 1,
          connections: 1,
          artifactsRoot: tmpdir(),
        })
      ).rejects.toThrow('failed to start ephemeral memory target: migration exploded');

      expect(pgStopMock).toHaveBeenCalledTimes(1);
      expect(redisStopMock).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      restoreLabEnv(previousEnv);
    }
  }, CLI_TEST_TIMEOUT_MS);
});

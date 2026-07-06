/**
 * Simulation harness preflight.
 *
 * Verifies the local lab substrate before a simulated epoch campaign is used
 * as evidence. It prints structured JSON and exits non-zero when any check
 * fails. No production URL is needed or accepted.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { runMigrations } from './migrate.js';

interface PreflightOptions {
  skipContainers: boolean;
}

interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  durationMs: number;
}

interface PreflightReport {
  generatedAt: string;
  success: boolean;
  checks: PreflightCheck[];
}

const execFileAsync = promisify(execFile);

function parseArgs(args: readonly string[]): PreflightOptions {
  return {
    skipContainers: args.includes('--skip-containers'),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function measureCheck(name: string, check: () => Promise<string>): Promise<PreflightCheck> {
  const startedAtMs = Date.now();
  try {
    const detail = await check();
    return {
      name,
      status: 'pass',
      detail,
      durationMs: Date.now() - startedAtMs,
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: errorMessage(err),
      durationMs: Date.now() - startedAtMs,
    };
  }
}

function skippedCheck(name: string, detail: string): PreflightCheck {
  return {
    name,
    status: 'skip',
    detail,
    durationMs: 0,
  };
}

async function checkHarnessFiles(): Promise<string> {
  const entries = await readdir('tests/harness', { recursive: true });
  const runnable = entries.filter((entry) => entry.endsWith('.test.ts') || entry.endsWith('.sim.ts'));
  if (runnable.length === 0) {
    throw new Error('No runnable tests/harness/**/*.test.ts or tests/harness/**/*.sim.ts files found');
  }
  return `found ${runnable.length} harness test/sim files`;
}

async function checkPackageScripts(): Promise<string> {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const requiredScripts = [
    'sim:core',
    'sim:preflight',
    'sim:campaign',
    'lab:jetstream-replay',
    'lab:vote-load',
    'lab:memory-isolated',
    'lab:memory-prod-parity',
  ];
  const missing = requiredScripts.filter((name) => !scripts[name]);
  if (missing.length > 0) {
    throw new Error(`package.json is missing required scripts: ${missing.join(', ')}`);
  }
  return `${requiredScripts.join(', ')} scripts are present`;
}

async function checkDockerInfo(): Promise<string> {
  const result = await execFileAsync('docker', ['info', '--format', '{{json .ServerVersion}}'], {
    timeout: 15_000,
  });
  const rawVersion = result.stdout.trim();
  const parsedVersion = JSON.parse(rawVersion) as unknown;
  const version = typeof parsedVersion === 'string' ? parsedVersion : rawVersion;
  if (!version) {
    throw new Error('docker info returned an empty server version');
  }
  return `docker server version ${version}`;
}

async function stopContainers(
  pg: StartedPostgreSqlContainer | undefined,
  redis: StartedRedisContainer | undefined
): Promise<void> {
  const results = await Promise.allSettled([pg?.stop(), redis?.stop()]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      'Failed to stop one or more simulation preflight containers'
    );
  }
}

function normalizePostgresUrl(url: string): string {
  return url.replace(/^postgres:\/\//, 'postgresql://');
}

async function runMigrationsWithStderrLogs(databaseUrl: string): Promise<void> {
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };
  try {
    await runMigrations(databaseUrl);
  } finally {
    console.log = originalConsoleLog;
  }
}

async function writeStdout(output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function writeStderr(output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(output, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function checkTestcontainersAndMigrations(): Promise<string> {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;
  let detail: string | undefined;

  try {
    const [pgResult, redisResult] = await Promise.allSettled([
      new PostgreSqlContainer('postgres:16')
        .withDatabase('corgi_sim_preflight')
        .withUsername('corgi_sim')
        .withPassword('corgi_sim')
        .start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    if (pgResult.status === 'fulfilled') {
      pg = pgResult.value;
    }
    if (redisResult.status === 'fulfilled') {
      redis = redisResult.value;
    }
    const startFailures = [pgResult, redisResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (startFailures.length === 1) {
      throw startFailures[0];
    }
    if (startFailures.length > 1) {
      throw new AggregateError(
        startFailures,
        'Failed to start one or more simulation preflight containers'
      );
    }
    if (pg === undefined || redis === undefined) {
      throw new Error('Testcontainers did not return both Postgres and Redis handles');
    }

    await runMigrationsWithStderrLogs(normalizePostgresUrl(pg.getConnectionUri()));
    detail = 'started postgres:16 and redis:7-alpine, then applied migrations';
  } catch (err) {
    primaryError = err;
  }

  try {
    await stopContainers(pg, redis);
  } catch (err) {
    cleanupError = err;
  }

  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Preflight check failed and container cleanup also failed'
    );
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  return detail ?? 'started postgres:16 and redis:7-alpine, then applied migrations';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checks: PreflightCheck[] = [];

  checks.push(await measureCheck('harness-files', checkHarnessFiles));
  checks.push(await measureCheck('package-scripts', checkPackageScripts));

  if (options.skipContainers) {
    checks.push(skippedCheck('docker-info', '--skip-containers was provided'));
    checks.push(skippedCheck('testcontainers-migrations', '--skip-containers was provided'));
  } else {
    const dockerInfoCheck = await measureCheck('docker-info', checkDockerInfo);
    checks.push(dockerInfoCheck);
    if (dockerInfoCheck.status === 'pass') {
      checks.push(await measureCheck('testcontainers-migrations', checkTestcontainersAndMigrations));
    } else {
      checks.push(skippedCheck('testcontainers-migrations', 'docker-info failed'));
    }
  }

  const report: PreflightReport = {
    generatedAt: new Date().toISOString(),
    success: checks.every((check) => check.status !== 'fail'),
    checks,
  };

  await writeStdout(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.success ? 0 : 1;
}

main().catch(async (err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  await writeStderr(`${message}\n`);
  process.exitCode = 1;
});

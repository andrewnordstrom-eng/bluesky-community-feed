import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 30_000;
const TSX_LOADER = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs');

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

function parsePreflightReport(stdout: string): PreflightReport {
  const parsed = JSON.parse(stdout) as PreflightReport;
  if (typeof parsed.success !== 'boolean') {
    throw new TypeError('preflight report success must be a boolean');
  }
  if (!Array.isArray(parsed.checks)) {
    throw new TypeError('preflight report checks must be an array');
  }
  for (const check of parsed.checks) {
    if (check.status !== 'pass' && check.status !== 'fail' && check.status !== 'skip') {
      throw new TypeError(`preflight check status must be pass, fail, or skip; received ${check.status}`);
    }
  }
  return parsed;
}

describe('sim-preflight', () => {
  it('treats skipped container checks as non-failures', async () => {
    const result = await execFileAsync(
      process.execPath,
      ['--import', TSX_LOADER, 'scripts/sim-preflight.ts', '--skip-containers'],
      {
        cwd: process.cwd(),
        timeout: 30_000,
      }
    );

    const report = parsePreflightReport(result.stdout);
    const dockerInfo = report.checks.find((check) => check.name === 'docker-info');
    const migrations = report.checks.find((check) => check.name === 'testcontainers-migrations');

    expect(report.success).toBe(true);
    expect(dockerInfo?.status).toBe('skip');
    expect(migrations?.status).toBe('skip');
    expect(report.checks.every((check) => check.status !== 'fail')).toBe(true);
  }, CLI_TEST_TIMEOUT_MS);

  it('prints parseable failure JSON when required local files are missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'corgi-preflight-missing-'));
    try {
      let execError: { stdout?: string; stderr?: string; code?: number } | null = null;
      await execFileAsync(
        process.execPath,
        ['--import', TSX_LOADER, join(process.cwd(), 'scripts/sim-preflight.ts'), '--skip-containers'],
        {
          cwd: tempDir,
          timeout: 30_000,
        }
      ).catch((error: unknown) => {
        execError = error as { stdout?: string; stderr?: string; code?: number };
      });
      if (execError === null) {
        throw new Error('sim-preflight unexpectedly passed in an empty working directory');
      }
      expect(execError.code).toBe(1);
      expect(execError.stderr ?? '').not.toMatch(/sim-preflight unexpectedly|at main/);

      const report = parsePreflightReport(execError.stdout ?? '');
      const harnessFiles = report.checks.find((check) => check.name === 'harness-files');
      const packageScripts = report.checks.find((check) => check.name === 'package-scripts');
      const dockerInfo = report.checks.find((check) => check.name === 'docker-info');

      expect(report.success).toBe(false);
      expect(harnessFiles?.status).toBe('fail');
      expect(packageScripts?.status).toBe('fail');
      expect(dockerInfo?.status).toBe('skip');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, CLI_TEST_TIMEOUT_MS);
});

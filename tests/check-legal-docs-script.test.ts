import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-legal-docs.sh',
);

function assertSpawnCompleted(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBeNull();
  expect(result.signal).toBeNull();
}

function runCheck(legalDir: string): SpawnSyncReturns<string> {
  return spawnSync('sh', [SCRIPT, legalDir], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function runRaw(args: string[]): SpawnSyncReturns<string> {
  return spawnSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function createTempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'corgi-legal-docs-'));
}

function writeTermsOfService(legalDir: string): void {
  writeFileSync(path.join(legalDir, 'TERMS_OF_SERVICE.md'), '# Terms\n');
}

function writePrivacyPolicy(legalDir: string): void {
  writeFileSync(path.join(legalDir, 'PRIVACY_POLICY.md'), '# Privacy\n');
}

function createLegalDir(): string {
  const legalDir = createTempRoot();
  writeTermsOfService(legalDir);
  writePrivacyPolicy(legalDir);
  return legalDir;
}

describe('check-legal-docs.sh', () => {
  it('accepts exactly the two runtime legal documents', () => {
    const legalDir = createLegalDir();

    try {
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a completely empty legal directory', () => {
    const legalDir = createTempRoot();

    try {
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'TERMS_OF_SERVICE.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a missing terms-of-service document', () => {
    const legalDir = createTempRoot();

    try {
      writePrivacyPolicy(legalDir);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'TERMS_OF_SERVICE.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an empty terms-of-service document', () => {
    const legalDir = createLegalDir();

    try {
      writeFileSync(path.join(legalDir, 'TERMS_OF_SERVICE.md'), '');
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'TERMS_OF_SERVICE.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a terms-of-service path that is a directory', () => {
    const legalDir = createTempRoot();

    try {
      mkdirSync(path.join(legalDir, 'TERMS_OF_SERVICE.md'));
      writePrivacyPolicy(legalDir);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'TERMS_OF_SERVICE.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a terms-of-service path that is a symlink', () => {
    const legalDir = createTempRoot();

    try {
      const linkedTermsPath = path.join(legalDir, 'TERMS_SOURCE.md');
      writeFileSync(linkedTermsPath, '# Terms\n');
      symlinkSync(linkedTermsPath, path.join(legalDir, 'TERMS_OF_SERVICE.md'));
      writePrivacyPolicy(legalDir);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'TERMS_OF_SERVICE.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a missing privacy policy document', () => {
    const legalDir = createTempRoot();

    try {
      writeTermsOfService(legalDir);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'PRIVACY_POLICY.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an empty privacy policy document', () => {
    const legalDir = createLegalDir();

    try {
      writeFileSync(path.join(legalDir, 'PRIVACY_POLICY.md'), '');
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'PRIVACY_POLICY.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a privacy-policy path that is a directory', () => {
    const legalDir = createTempRoot();

    try {
      writeTermsOfService(legalDir);
      mkdirSync(path.join(legalDir, 'PRIVACY_POLICY.md'));
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'PRIVACY_POLICY.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects a privacy-policy path that is a symlink', () => {
    const legalDir = createTempRoot();

    try {
      writeTermsOfService(legalDir);
      const linkedPrivacyPath = path.join(legalDir, 'PRIVACY_SOURCE.md');
      writeFileSync(linkedPrivacyPath, '# Privacy\n');
      symlinkSync(linkedPrivacyPath, path.join(legalDir, 'PRIVACY_POLICY.md'));
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Missing or empty ${path.join(legalDir, 'PRIVACY_POLICY.md')}`,
      );
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected top-level file', () => {
    const legalDir = createLegalDir();

    try {
      const unexpectedPath = path.join(legalDir, 'README.md');
      writeFileSync(unexpectedPath, '# README\n');
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Unexpected file in ${legalDir}: ${unexpectedPath}`);
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected top-level hidden file', () => {
    const legalDir = createLegalDir();

    try {
      const unexpectedPath = path.join(legalDir, '.DS_Store');
      writeFileSync(unexpectedPath, 'finder metadata\n');
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Unexpected file in ${legalDir}: ${unexpectedPath}`);
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected top-level directory', () => {
    const legalDir = createLegalDir();

    try {
      const unexpectedPath = path.join(legalDir, 'archive');
      mkdirSync(unexpectedPath);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Unexpected file in ${legalDir}: ${unexpectedPath}`);
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected top-level symlink', () => {
    const legalDir = createLegalDir();

    try {
      const termsPath = path.join(legalDir, 'TERMS_OF_SERVICE.md');
      const unexpectedPath = path.join(legalDir, 'TERMS_LINK.md');
      symlinkSync(termsPath, unexpectedPath);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Unexpected file in ${legalDir}: ${unexpectedPath}`);
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected dangling top-level symlink', () => {
    const legalDir = createLegalDir();

    try {
      const unexpectedPath = path.join(legalDir, 'MISSING_LINK.md');
      symlinkSync(path.join(legalDir, 'missing-target.md'), unexpectedPath);
      const result = runCheck(legalDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Unexpected file in ${legalDir}: ${unexpectedPath}`);
    } finally {
      rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid argument counts', () => {
    const result = runRaw([]);

    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: check-legal-docs.sh <legal-dir>');
  });

  it('rejects too many arguments', () => {
    const result = runRaw(['/tmp/one', '/tmp/two']);

    assertSpawnCompleted(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: check-legal-docs.sh <legal-dir>');
  });

  it('rejects a non-existent legal directory', () => {
    const rootDir = createTempRoot();
    const missingDir = path.join(rootDir, 'missing');

    try {
      const result = runCheck(missingDir);

      assertSpawnCompleted(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Missing legal directory: ${missingDir}`);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

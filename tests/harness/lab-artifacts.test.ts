import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectArtifactDescriptor,
  collectGitBranch,
  collectGitState,
  resolveLabRunDirectory,
  sha256Text,
  writeChecksums,
  writeJsonArtifact,
  writeLabManifest,
  type LabArtifactDescriptor,
  type LabManifest,
} from '../../src/harness/lab-artifacts.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout.trim();
}

function validManifest(): LabManifest {
  return {
    schemaVersion: '1.0.0',
    issue: 'PROJ-1551',
    branch: 'dev/PROJ-1551-corgi-validation',
    git: {
      head: 'a'.repeat(40),
      base: 'b'.repeat(40),
      dirtyFiles: [],
      diffSha256: 'c'.repeat(64),
    },
    command: {
      argv: ['node', 'script.ts'],
      cwd: '/tmp/corgi-lab',
      exitCode: 0,
      stdoutPath: null,
      stderrPath: null,
    },
    envAllowlist: {
      NODE_ENV: 'test',
    },
    runtime: {
      node: 'v24.15.0',
      npm: '11.12.1',
      platform: process.platform,
      arch: process.arch,
      release: '25.5.0',
      cpus: 1,
      totalMemoryBytes: 1,
    },
    startedAt: '2026-07-06T19:05:07.506Z',
    endedAt: '2026-07-06T19:05:09.372Z',
    artifacts: [
      {
        path: 'phase/summary.json',
        sha256: 'd'.repeat(64),
        bytes: 10,
        mediaType: 'application/json',
        producedBy: 'test',
      },
    ],
    thresholds: {
      droppedEvents: 0,
    },
    claims: [
      {
        claim: 'test claim',
        status: 'pass',
        evidencePaths: ['phase/summary.json'],
      },
    ],
  };
}

describe('lab artifact git metadata', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'corgi-lab-artifacts-'));
    await git(repoDir, ['init']);
    await git(repoDir, ['config', 'user.email', 'corgi@example.test']);
    await git(repoDir, ['config', 'user.name', 'Corgi Test']);
    await writeFile(join(repoDir, 'README.md'), 'lab metadata fixture\n', 'utf8');
    await git(repoDir, ['add', 'README.md']);
    await git(repoDir, ['commit', '-m', 'initial']);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('uses the active branch name when HEAD is attached', async () => {
    const expectedBranch = await git(repoDir, ['branch', '--show-current']);

    await expect(collectGitBranch(repoDir)).resolves.toBe(expectedBranch);
  });

  it('falls back to a detached short SHA when HEAD is detached', async () => {
    const shortHead = await git(repoDir, ['rev-parse', '--short', 'HEAD']);
    await git(repoDir, ['switch', '--detach', 'HEAD']);

    await expect(collectGitBranch(repoDir)).resolves.toBe(`detached-${shortHead}`);
  });

  it('rejects unsafe lab run path segments', () => {
    expect(() => resolveLabRunDirectory(repoDir, '../PROJ-1551', 'run-id')).toThrow(RangeError);
    expect(() => resolveLabRunDirectory(repoDir, 'PROJ-1551', '/absolute-run')).toThrow(RangeError);
    expect(() => resolveLabRunDirectory(repoDir, '', 'run-id')).toThrow(RangeError);
    expect(() => resolveLabRunDirectory(repoDir, 'PROJ-1551', '')).toThrow(RangeError);
    expect(() => resolveLabRunDirectory(repoDir, 'PROJ-1551', 'foo/bar')).toThrow(RangeError);
  });

  it('writes JSON artifacts only for safe .json filenames', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'run-id');

    await expect(writeJsonArtifact(runDirectory, 'summary.json', { ok: true })).resolves.toBe(
      join(runDirectory, 'summary.json')
    );
    await expect(writeJsonArtifact(runDirectory, 'summary.txt', { ok: true })).rejects.toThrow(RangeError);
    await expect(writeJsonArtifact(runDirectory, '../summary.json', { ok: true })).rejects.toThrow(RangeError);
    await expect(writeJsonArtifact(runDirectory, '/tmp/summary.json', { ok: true })).rejects.toThrow(RangeError);
  });

  it('collects artifact descriptors only for files inside the run directory', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'run-id');
    const artifactPath = await writeJsonArtifact(runDirectory, 'summary.json', { ok: true });
    const outsidePath = join(repoDir, 'outside.json');
    const directoryPath = join(runDirectory, 'nested');
    await writeFile(outsidePath, '{}\n', 'utf8');
    await mkdir(directoryPath, { recursive: true });

    const descriptor = await collectArtifactDescriptor(
      runDirectory,
      artifactPath,
      'application/json',
      'tests/harness/lab-artifacts.test.ts'
    );

    expect(descriptor).toEqual({
      path: 'summary.json',
      sha256: sha256Text('{\n  "ok": true\n}\n'),
      bytes: 17,
      mediaType: 'application/json',
      producedBy: 'tests/harness/lab-artifacts.test.ts',
    });
    await expect(
      collectArtifactDescriptor(runDirectory, outsidePath, 'application/json', 'test')
    ).rejects.toThrow(RangeError);
    await expect(
      collectArtifactDescriptor(runDirectory, directoryPath, 'application/json', 'test')
    ).rejects.toThrow(TypeError);
    await expect(
      collectArtifactDescriptor(runDirectory, join(runDirectory, 'missing.json'), 'application/json', 'test')
    ).rejects.toThrow();
  });

  it('rejects artifact symlinks that resolve outside the run directory', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'run-id');
    await mkdir(runDirectory, { recursive: true });
    const outsidePath = join(repoDir, 'outside.json');
    const symlinkPath = join(runDirectory, 'outside-link.json');
    await writeFile(outsidePath, '{}\n', 'utf8');
    await symlink(outsidePath, symlinkPath);

    await expect(
      collectArtifactDescriptor(runDirectory, symlinkPath, 'application/json', 'test')
    ).rejects.toThrow(RangeError);
  });

  it('writes checksum lines sorted by artifact path', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'run-id');
    const artifacts: LabArtifactDescriptor[] = [
      { path: 'z.json', sha256: 'z-sha', bytes: 1, mediaType: 'application/json', producedBy: 'test' },
      { path: 'a.json', sha256: 'a-sha', bytes: 1, mediaType: 'application/json', producedBy: 'test' },
    ];

    const checksumsPath = await writeChecksums(runDirectory, artifacts);
    await expect(readFile(checksumsPath, 'utf8')).resolves.toBe('a-sha  a.json\nz-sha  z.json\n');
  });

  it('writes an empty checksum file for an empty artifact list', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'empty-checksums');

    const checksumsPath = await writeChecksums(runDirectory, []);

    await expect(readFile(checksumsPath, 'utf8')).resolves.toBe('\n');
  });

  it('validates lab manifests against the checked-in schema before writing', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'manifest-valid');

    const manifestPath = await writeLabManifest(runDirectory, validManifest());

    await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"schemaVersion": "1.0.0"');
  });

  it('rejects lab manifests with claims that have no evidence paths', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'manifest-invalid');
    const manifest = validManifest() as unknown as {
      claims: Array<{ evidencePaths: string[] }>;
    } & LabManifest;
    const firstClaim = manifest.claims[0];
    if (firstClaim === undefined) {
      throw new Error('validManifest must include a claim fixture');
    }
    firstClaim.evidencePaths = [];

    await expect(writeLabManifest(runDirectory, manifest)).rejects.toThrow(
      /Lab manifest failed schema validation/
    );
  });

  it('allows blocked lab manifest claims without evidence paths', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'manifest-blocked');
    const manifest = validManifest();
    manifest.claims = [
      {
        claim: 'shared-environment saturation remains approval-gated',
        status: 'blocked',
      },
    ];

    const manifestPath = await writeLabManifest(runDirectory, manifest);

    await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"status": "blocked"');
  });

  it('allows not-run lab manifest claims with empty evidence paths', async () => {
    const runDirectory = resolveLabRunDirectory(repoDir, 'PROJ-1551', 'manifest-not-run');
    const manifest = validManifest();
    manifest.claims = [
      {
        claim: 'staging vote load was not run',
        status: 'not-run',
        evidencePaths: [],
      },
    ];

    const manifestPath = await writeLabManifest(runDirectory, manifest);

    await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"status": "not-run"');
  });

  it('reports a clean repo with an empty dirty file list and empty diff hash', async () => {
    const state = await collectGitState(repoDir, 'HEAD');

    expect(state.dirtyFiles).toEqual([]);
    expect(state.diffSha256).toBe(sha256Text('\0'));
  });

  it('collects dirty git metadata with deterministic hashes', async () => {
    const head = await git(repoDir, ['rev-parse', 'HEAD']);
    await writeFile(join(repoDir, 'README.md'), 'changed lab metadata fixture\n', 'utf8');

    const state = await collectGitState(repoDir, 'HEAD');

    expect(state.head).toBe(head);
    expect(state.base).toBe(head);
    expect(state.dirtyFiles).toContain(' M README.md');
    expect(state.diffSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(state.diffSha256).not.toBe(sha256Text(''));
  });

  it('includes untracked file contents in the dirty git hash', async () => {
    await writeFile(join(repoDir, 'untracked.json'), '{"receipt":true}\n', 'utf8');

    const state = await collectGitState(repoDir, 'HEAD');

    expect(state.dirtyFiles).toContain('?? untracked.json');
    expect(state.diffSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(state.diffSha256).not.toBe(sha256Text('\0'));
  });

  it('fails git metadata collection for non-git directories', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'corgi-lab-nongit-'));
    try {
      await expect(collectGitBranch(nonGitDir)).rejects.toThrow('failed to execute git branch --show-current');
      await expect(collectGitState(nonGitDir, 'HEAD')).rejects.toThrow('failed to execute git rev-parse HEAD');
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

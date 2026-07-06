import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 30_000;
const MANIFEST_SCHEMA_PATH = path.resolve(process.cwd(), 'artifacts/lab/manifest.schema.json');

export interface LabArtifactDescriptor {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
  producedBy: string;
}

interface LabClaimWithEvidence {
  claim: string;
  status: 'pass' | 'fail';
  evidencePaths: [string, ...string[]];
}

interface LabClaimWithoutEvidence {
  claim: string;
  status: 'blocked' | 'not-run';
  evidencePaths?: string[];
}

export type LabClaim = LabClaimWithEvidence | LabClaimWithoutEvidence;

export interface LabCommandReceipt {
  argv: string[];
  cwd: string;
  exitCode: number | null;
  stdoutPath: string | null;
  stderrPath: string | null;
}

export interface LabGitState {
  head: string;
  base: string;
  dirtyFiles: string[];
  diffSha256: string;
}

export interface LabRuntimeState {
  node: string;
  npm: string;
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  cpus: number;
  totalMemoryBytes: number;
}

export interface LabManifest {
  schemaVersion: '1.0.0';
  issue: string;
  branch: string;
  git: LabGitState;
  command: LabCommandReceipt;
  envAllowlist: Record<string, string>;
  runtime: LabRuntimeState;
  startedAt: string;
  endedAt: string;
  artifacts: LabArtifactDescriptor[];
  thresholds: Record<string, unknown>;
  claims: LabClaim[];
}

let manifestValidatorPromise: Promise<ValidateFunction<unknown>> | null = null;

export function createLabRunId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function assertSafePathSegment(label: string, value: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    path.isAbsolute(value) ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new RangeError(`${label} must be a safe path segment; received ${value}`);
  }
}

function assertPathInsideRoot(rootDirectory: string, candidatePath: string, label: string): string {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new RangeError(`${label} must stay inside ${resolvedRoot}; received ${candidatePath}`);
  }
  return resolvedCandidate;
}

async function assertRealPathInsideRoot(rootDirectory: string, candidatePath: string, label: string): Promise<string> {
  const realRoot = await realpath(rootDirectory);
  const realCandidate = await realpath(candidatePath);
  const relativePath = path.relative(realRoot, realCandidate);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new RangeError(`${label} must stay inside ${realRoot}; received ${candidatePath}`);
  }
  return realCandidate;
}

export function resolveLabRunDirectory(rootDir: string, issue: string, runId: string): string {
  assertSafePathSegment('issue', issue);
  assertSafePathSegment('runId', runId);
  return assertPathInsideRoot(rootDir, path.resolve(rootDir, issue, runId), 'run directory');
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

export async function writeJsonArtifact(directory: string, filename: string, value: unknown): Promise<string> {
  assertSafePathSegment('filename', filename);
  if (!filename.endsWith('.json')) {
    throw new RangeError(`JSON artifact filename must end with .json; received ${filename}`);
  }

  await ensureDirectory(directory);
  const filePath = assertPathInsideRoot(directory, path.join(directory, filename), 'JSON artifact path');
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function collectArtifactDescriptor(
  runDirectory: string,
  artifactPath: string,
  mediaType: string,
  producedBy: string
): Promise<LabArtifactDescriptor> {
  const resolvedArtifactPath = assertPathInsideRoot(runDirectory, artifactPath, 'artifactPath');
  const realArtifactPath = await assertRealPathInsideRoot(runDirectory, resolvedArtifactPath, 'artifactPath');
  const artifactStat = await stat(realArtifactPath);
  if (!artifactStat.isFile()) {
    throw new TypeError(`artifactPath must be a file; received ${artifactPath}`);
  }

  return {
    path: path.relative(path.resolve(runDirectory), resolvedArtifactPath),
    sha256: await sha256File(realArtifactPath),
    bytes: artifactStat.size,
    mediaType,
    producedBy,
  };
}

export async function writeChecksums(runDirectory: string, artifacts: readonly LabArtifactDescriptor[]): Promise<string> {
  await ensureDirectory(runDirectory);
  const lines = artifacts
    .slice()
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((artifact) => `${artifact.sha256}  ${artifact.path}`);
  const checksumsPath = path.join(runDirectory, 'checksums.sha256');
  await writeFile(checksumsPath, `${lines.join('\n')}\n`, 'utf8');
  return checksumsPath;
}

function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return 'unknown schema error';
  }
  return errors
    .map((error) => {
      const pathLabel = error.instancePath || '/';
      return `${pathLabel} ${error.message ?? 'failed validation'}`;
    })
    .join('; ');
}

async function getManifestValidator(): Promise<ValidateFunction<unknown>> {
  if (manifestValidatorPromise !== null) {
    return manifestValidatorPromise;
  }

  manifestValidatorPromise = (async () => {
    const rawSchema = await readFile(MANIFEST_SCHEMA_PATH, 'utf8');
    const schema = JSON.parse(rawSchema) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    return ajv.compile(schema);
  })();
  return manifestValidatorPromise;
}

async function validateLabManifest(manifest: LabManifest): Promise<void> {
  const validate = await getManifestValidator();
  if (!validate(manifest)) {
    throw new TypeError(`Lab manifest failed schema validation: ${formatSchemaErrors(validate.errors)}`);
  }
}

export async function writeLabManifest(runDirectory: string, manifest: LabManifest): Promise<string> {
  await validateLabManifest(manifest);
  return writeJsonArtifact(runDirectory, 'manifest.json', manifest);
}

async function execTextRaw(command: string, args: readonly string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      timeout: EXEC_TIMEOUT_MS,
    });
    return stdout;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`failed to execute ${command} ${args.join(' ')} in ${cwd}: ${error.message}`);
    }
    throw new Error(`failed to execute ${command} ${args.join(' ')} in ${cwd}: non-Error thrown`);
  }
}

async function execText(command: string, args: readonly string[], cwd: string): Promise<string> {
  return (await execTextRaw(command, args, cwd)).trim();
}

async function collectUntrackedFileHashInput(cwd: string): Promise<string> {
  const untrackedOutput = await execTextRaw('git', ['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  const untrackedPaths = untrackedOutput
    .split('\0')
    .filter((untrackedPath) => untrackedPath.length > 0)
    .sort();

  const chunks: string[] = [];
  for (const untrackedPath of untrackedPaths) {
    const resolvedPath = assertPathInsideRoot(cwd, path.join(cwd, untrackedPath), 'untracked git file');
    const realPath = await assertRealPathInsideRoot(cwd, resolvedPath, 'untracked git file');
    const fileStat = await stat(realPath);
    if (!fileStat.isFile()) {
      continue;
    }
    const contents = await readFile(realPath);
    chunks.push(`untracked:${untrackedPath}\0${contents.toString('base64')}`);
  }

  return chunks.join('\0');
}

export async function collectGitState(cwd: string, baseRef: string): Promise<LabGitState> {
  const head = await execText('git', ['rev-parse', 'HEAD'], cwd);
  const status = await execTextRaw('git', ['status', '--porcelain=v1'], cwd);
  const diff = await execTextRaw('git', ['--no-pager', 'diff', 'HEAD', '--binary'], cwd);
  const untrackedHashInput = await collectUntrackedFileHashInput(cwd);
  const base = await execText('git', ['merge-base', 'HEAD', '--', baseRef], cwd);

  return {
    head,
    base,
    dirtyFiles: status
      .split('\n')
      .filter((line) => line.length > 0),
    diffSha256: sha256Text(`${diff}\0${untrackedHashInput}`),
  };
}

export async function collectGitBranch(cwd: string): Promise<string> {
  const branch = await execText('git', ['branch', '--show-current'], cwd);
  if (branch) {
    return branch;
  }
  const shortHead = await execText('git', ['rev-parse', '--short', 'HEAD'], cwd);
  return `detached-${shortHead}`;
}

export async function collectRuntimeState(cwd: string): Promise<LabRuntimeState> {
  const npm = await execText('npm', ['--version'], cwd);
  return {
    node: process.version,
    npm,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

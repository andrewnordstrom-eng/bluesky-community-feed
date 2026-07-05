import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface RollbackResult {
  status: number | null;
  stdout: string;
  stderr: string;
  restartLog: string;
  markerText: string;
}

type RollbackEntrypoint = 'fail_and_rollback' | 'exit_before_restart' | 'rollback_before_restart';

interface RollbackScenario {
  artifactStatus: number;
  entrypoint: RollbackEntrypoint;
  gitScript: string;
}

const WORKFLOW_PATH = new URL('../.github/workflows/deploy.yml', import.meta.url);

function extractDeployShell(): string {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const start = workflow.indexOf('            set -euo pipefail');
  const end = workflow.indexOf('\n\n      - name:', start === -1 ? 0 : start + 1);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Failed to locate deploy shell block in ${WORKFLOW_PATH.pathname}`);
  }

  return workflow
    .slice(start, end)
    .split('\n')
    .map((line) => (line.startsWith('            ') ? line.slice(12) : line))
    .join('\n');
}

function extractFunction(shell: string, functionName: string): string {
  const lines = shell.split('\n');
  const start = lines.findIndex((line) => line === `${functionName}() {`);

  if (start === -1) {
    throw new Error(`Failed to locate ${functionName} in deploy shell`);
  }

  const selectedLines: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    selectedLines.push(lines[index]);
    if (index > start && lines[index] === '}') {
      return selectedLines.join('\n');
    }
  }

  throw new Error(`Failed to find end of ${functionName} in deploy shell`);
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function readFileIfExists(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function rewriteDeployRoot(functionBody: string): string {
  const deployRootCommand = 'cd /opt/bluesky-feed';

  if (!functionBody.includes(deployRootCommand)) {
    throw new Error(`Deploy rollback harness could not find expected command: ${deployRootCommand}`);
  }

  return functionBody.replaceAll(deployRootCommand, 'cd "$DEPLOY_TEST_ROOT"');
}

function getEntrypointInvocation(entrypoint: RollbackEntrypoint): string {
  if (entrypoint === 'fail_and_rollback') {
    return 'fail_and_rollback "restart"';
  }
  if (entrypoint === 'exit_before_restart') {
    return 'exit_before_restart 7';
  }
  return 'set +e\nfalse\nrollback_before_restart';
}

function runRollbackScenario(scenario: RollbackScenario): RollbackResult {
  const deployShell = extractDeployShell();
  const exitBeforeRestart = rewriteDeployRoot(extractFunction(deployShell, 'exit_before_restart'));
  const recoveryMarker = extractFunction(deployShell, 'write_rollback_recovery_marker');
  const rollbackCheckout = rewriteDeployRoot(extractFunction(deployShell, 'rollback_checkout'));
  const rollbackBeforeRestart = rewriteDeployRoot(extractFunction(deployShell, 'rollback_before_restart'));
  const failAndRollback = extractFunction(deployShell, 'fail_and_rollback');
  const root = mkdtempSync(path.join(tmpdir(), 'corgi-deploy-rollback-'));
  const binDir = path.join(root, 'bin');
  const artifactDir = path.join(root, 'rollback-artifacts');
  const markerPath = path.join(artifactDir, 'MANUAL_RECOVERY_REQUIRED.txt');
  const restartLogPath = path.join(root, 'restart.log');
  const harnessPath = path.join(root, 'harness.sh');

  try {
    mkdirSync(binDir);
    mkdirSync(artifactDir);
    writeExecutable(path.join(binDir, 'git'), scenario.gitScript);
    writeExecutable(path.join(binDir, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(binDir, 'sudo'), '#!/usr/bin/env bash\necho "$*" >> "$DEPLOY_TEST_RESTART_LOG"\nexit 0\n');

    writeFileSync(
      harnessPath,
      `#!/usr/bin/env bash
set -euo pipefail
PATH="${binDir}:$PATH"
DEPLOY_TEST_ROOT="${root}"
DEPLOY_TEST_RESTART_LOG="${restartLogPath}"
export DEPLOY_TEST_RESTART_LOG
ROLLBACK_ARTIFACT_DIR="${artifactDir}"
PREV_COMMIT="abc123"
cleanup_rollback_artifacts() { :; }
cleanup_env_backup() { :; }
restore_env_file() { :; }
restore_frontend_artifacts() { return ${scenario.artifactStatus}; }
${exitBeforeRestart}
${recoveryMarker}
${rollbackCheckout}
${rollbackBeforeRestart}
${failAndRollback}
${getEntrypointInvocation(scenario.entrypoint)}
`,
    );

    const result = spawnSync('bash', [harnessPath], {
      encoding: 'utf8',
      env: process.env,
      timeout: 10_000,
    });

    if (result.error) {
      throw new Error(`Rollback harness failed: ${result.error.message}; stdout=${result.stdout}; stderr=${result.stderr}`);
    }

    const restartLog = readFileIfExists(restartLogPath);
    const markerText = readFileIfExists(markerPath);

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      restartLog,
      markerText,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('deploy rollback workflow', () => {
  it('fails fast if deploy-root path rewriting cannot be applied', () => {
    expect(() => rewriteDeployRoot('rollback_checkout() {\n  cd /tmp/bluesky-feed\n}')).toThrow(
      /could not find expected command/,
    );
  });

  it('refuses to restart when rollback cannot check out main', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'fail_and_rollback',
      gitScript: `#!/usr/bin/env bash
if [ "$1" = "checkout" ]; then
  exit 7
fi
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('git checkout main failed during rollback');
    expect(result.stdout).toContain('refusing to restart service on unknown code');
    expect(result.stdout).toContain('Preserving rollback artifacts for manual recovery');
    expect(result.markerText).toContain('manual_recovery_required=true');
    expect(result.markerText).toContain('reason="git checkout main failed during rollback"');
    expect(result.restartLog).toBe('');
    expect(result.stderr).toBe('');
  });

  it('refuses to restart when rollback cannot reset to the previous commit', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'fail_and_rollback',
      gitScript: `#!/usr/bin/env bash
if [ "$1" = "reset" ]; then
  exit 8
fi
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('git reset --hard abc123 failed during rollback');
    expect(result.stdout).toContain('refusing to restart service on unknown code');
    expect(result.stdout).toContain('Preserving rollback artifacts for manual recovery');
    expect(result.markerText).toContain('manual_recovery_required=true');
    expect(result.markerText).toContain('reason="git reset --hard abc123 failed during rollback"');
    expect(result.restartLog).toBe('');
    expect(result.stderr).toBe('');
  });

  it('short-circuits when checkout fails before attempting reset', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'fail_and_rollback',
      gitScript: `#!/usr/bin/env bash
echo "git:$*"
if [ "$1" = "checkout" ]; then
  exit 99
fi
if [ "$1" = "reset" ]; then
  exit 98
fi
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('git:checkout main');
    expect(result.stdout).not.toContain('git:reset');
    expect(result.stdout).toContain('refusing to restart service on unknown code');
    expect(result.markerText).toContain('reason="git checkout main failed during rollback"');
    expect(result.restartLog).toBe('');
    expect(result.stderr).toBe('');
  });

  it('preserves recovery artifacts when exit_before_restart hits a git rollback failure', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'exit_before_restart',
      gitScript: `#!/usr/bin/env bash
if [ "$1" = "checkout" ]; then
  exit 7
fi
exit 0
`,
    });

    expect(result.status).toBe(7);
    expect(result.stdout).toContain('git checkout main failed during rollback');
    expect(result.stdout).toContain('Preserving rollback artifacts for manual recovery');
    expect(result.markerText).toContain('reason="git checkout main failed during rollback"');
    expect(result.restartLog).toBe('');
    expect(result.stderr).toBe('');
  });

  it('preserves recovery artifacts when rollback_before_restart hits a git rollback failure', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'rollback_before_restart',
      gitScript: `#!/usr/bin/env bash
if [ "$1" = "reset" ]; then
  exit 8
fi
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('DEPLOY FAILED before service restart');
    expect(result.stdout).toContain('git reset --hard abc123 failed during rollback');
    expect(result.stdout).toContain('Preserving rollback artifacts for manual recovery');
    expect(result.markerText).toContain('reason="git reset --hard abc123 failed during rollback"');
    expect(result.restartLog).toBe('');
    expect(result.stderr).toBe('');
  });

  it('restarts without warnings when rollback preparation fully succeeds', () => {
    const result = runRollbackScenario({
      artifactStatus: 0,
      entrypoint: 'fail_and_rollback',
      gitScript: `#!/usr/bin/env bash
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('frontend artifact restore failed');
    expect(result.stdout).not.toContain('rollback preparation was incomplete');
    expect(result.markerText).toBe('');
    expect(result.restartLog).toContain('systemctl restart bluesky-feed');
    expect(result.stderr).toBe('');
  });

  it('allows restart when git rollback succeeds but artifact restore warns', () => {
    const result = runRollbackScenario({
      artifactStatus: 1,
      entrypoint: 'fail_and_rollback',
      gitScript: `#!/usr/bin/env bash
exit 0
`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('frontend artifact restore failed; attempting service restart anyway');
    expect(result.stdout).toContain('rollback preparation was incomplete; attempting service restart anyway');
    expect(result.markerText).toBe('');
    expect(result.restartLog).toContain('systemctl restart bluesky-feed');
    expect(result.stderr).toBe('');
  });
});

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8');
}

function probeWatchdogFunction(
  watchdog: string,
  functionName: 'worker_heartbeat_healthy' | 'feed_snapshot_healthy',
  environment: Record<string, string>,
  dockerFunction: string
): boolean {
  const definitions = watchdog.slice(0, watchdog.indexOf('# ── Disk space check'));
  const script = `${definitions}
timeout() { shift; "$@"; }
${dockerFunction}
if ${functionName}; then exit 0; else exit 1; fi
`;
  try {
    execFileSync('bash', ['-c', script], {
      env: { ...process.env, ...environment },
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

describe('ranking worker deployment contracts', () => {
  it('gives API and worker independent process roles and memory boundaries', async () => {
    const [apiUnit, workerUnit] = await Promise.all([
      source('ops/bluesky-feed.service'),
      source('ops/corgi-ranking-worker.service'),
    ]);

    expect(apiUnit).toContain('Environment=PROCESS_ROLE=api');
    expect(workerUnit).toContain('Environment=PROCESS_ROLE=ranking-worker');
    expect(workerUnit).toContain('MemoryMax=1G');
    expect(workerUnit).toContain('TimeoutStopSec=300');
    expect(workerUnit).toContain('ExecStart=/usr/bin/node dist/index.js');
  });

  it('runs backup verification and migrations before either process restart', async () => {
    const deploy = await source('.github/workflows/deploy.yml');
    const backupIndex = deploy.indexOf('sudo gzip -t "$LATEST_BACKUP"');
    const migrationIndex = deploy.indexOf('npm run migrate');
    const workerRestartIndex = deploy.indexOf('sudo systemctl restart corgi-ranking-worker');
    const apiRestartIndex = deploy.indexOf('sudo systemctl restart bluesky-feed');

    expect(backupIndex).toBeGreaterThan(0);
    expect(migrationIndex).toBeGreaterThan(backupIndex);
    expect(workerRestartIndex).toBeGreaterThan(migrationIndex);
    expect(apiRestartIndex).toBeGreaterThan(workerRestartIndex);
    expect(deploy).toContain('if ! BACKUP_TARGET=$(findmnt');
    expect(deploy).toContain('if ! LATEST_BACKUP=$(sudo find');
    expect(deploy).not.toContain('| head -1 |');
  });

  it('keeps every remote command inside the workflow YAML block scalar', async () => {
    const workflow = await source('.github/workflows/deploy.yml');
    const lines = workflow.split('\n');
    const scriptLine = lines.findIndex((line) => line === '          script: |');
    const nextStep = lines.findIndex((line, index) => (
      index > scriptLine && line.startsWith('      - name:')
    ));
    expect(scriptLine).toBeGreaterThan(0);
    expect(nextStep).toBeGreaterThan(scriptLine);
    for (const line of lines.slice(scriptLine + 1, nextStep)) {
      if (line.trim()) {
        expect(line.startsWith('            '), `misindented workflow line: ${line}`).toBe(true);
      }
    }
  });

  it('proves worker readiness before touching the API in both deploy paths', async () => {
    const [workflow, deploy] = await Promise.all([
      source('.github/workflows/deploy.yml'),
      source('ops/deploy'),
    ]);
    for (const script of [workflow, deploy]) {
      const workerRestart = script.indexOf('restart corgi-ranking-worker');
      const heartbeatPassed = script.indexOf('Ranking worker heartbeat passed');
      const apiRestart = script.indexOf('restart bluesky-feed');
      expect(workerRestart).toBeGreaterThan(0);
      expect(heartbeatPassed).toBeGreaterThan(workerRestart);
      expect(apiRestart).toBeGreaterThan(heartbeatPassed);
      expect(script).toContain('API was not touched');
    }
  });

  it('checks and restarts worker health without restarting the API', async () => {
    const watchdog = await source('ops/health-watchdog');
    const workerChecks = watchdog.slice(
      watchdog.indexOf('if worker_unit_installed; then'),
      watchdog.indexOf('# Try health check with retries')
    );

    expect(watchdog).toContain('corgi:ranking-worker:heartbeat:${RANKING_COMMUNITY_ID}');
    expect(watchdog).toContain('timeout "$PROBE_TIMEOUT_SECONDS" docker exec');
    expect(workerChecks).toContain('systemctl restart "$WORKER_SERVICE"');
    expect(workerChecks.match(/systemctl restart "\$WORKER_SERVICE"/g)).toHaveLength(1);
    expect(workerChecks).not.toContain('systemctl restart "$SERVICE"');
  });

  it('rejects malformed worker heartbeats and accepts a fresh configured-community heartbeat', async () => {
    const watchdog = await source('ops/health-watchdog');
    const updatedAt = new Date().toISOString();
    const dockerFunction = `docker() {
      if [ "\${*: -1}" != "corgi:ranking-worker:heartbeat:future-feed" ]; then return 2; fi
      printf '%s' "$FAKE_HEARTBEAT"
    }`;

    expect(probeWatchdogFunction(
      watchdog,
      'worker_heartbeat_healthy',
      {
        RANKING_COMMUNITY_ID: 'future-feed',
        FAKE_HEARTBEAT: JSON.stringify({ updatedAt, state: 'idle' }),
      },
      dockerFunction
    )).toBe(true);
    expect(probeWatchdogFunction(
      watchdog,
      'worker_heartbeat_healthy',
      { RANKING_COMMUNITY_ID: 'future-feed', FAKE_HEARTBEAT: '{malformed' },
      dockerFunction
    )).toBe(false);
  });

  it('enforces feed snapshot count and freshness boundaries', async () => {
    const watchdog = await source('ops/health-watchdog');
    const dockerFunction = `docker() {
      case "$*" in
        *"ZCARD feed:current") printf '%s' "$FAKE_COUNT" ;;
        *"GET feed:updated_at") printf '%s' "$FAKE_UPDATED_AT" ;;
        *) return 2 ;;
      esac
    }`;
    const nowMs = Date.now();

    expect(probeWatchdogFunction(
      watchdog,
      'feed_snapshot_healthy',
      {
        RANKING_COMMUNITY_ID: 'community-gov',
        FAKE_COUNT: '1000',
        FAKE_UPDATED_AT: new Date(nowMs - 599_000).toISOString(),
      },
      dockerFunction
    )).toBe(true);
    expect(probeWatchdogFunction(
      watchdog,
      'feed_snapshot_healthy',
      {
        RANKING_COMMUNITY_ID: 'community-gov',
        FAKE_COUNT: '0',
        FAKE_UPDATED_AT: new Date(nowMs).toISOString(),
      },
      dockerFunction
    )).toBe(false);
    expect(probeWatchdogFunction(
      watchdog,
      'feed_snapshot_healthy',
      {
        RANKING_COMMUNITY_ID: 'community-gov',
        FAKE_COUNT: '1000',
        FAKE_UPDATED_AT: new Date(nowMs - 601_000).toISOString(),
      },
      dockerFunction
    )).toBe(false);
  });

  it('fails installation instead of claiming an unenabled worker', async () => {
    const installScript = await source('ops/install.sh');
    const workerEnable = installScript.slice(
      installScript.indexOf('if ! systemctl list-unit-files corgi-ranking-worker.service'),
      installScript.indexOf('echo "✓ corgi-ranking-worker enabled')
    );

    expect(workerEnable).toContain('exit 1');
    expect(workerEnable).not.toContain('|| true');
  });
});

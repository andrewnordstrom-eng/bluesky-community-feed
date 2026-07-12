import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8');
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
  });

  it('checks and restarts worker health without restarting the API', async () => {
    const watchdog = await source('ops/health-watchdog');
    const workerChecks = watchdog.slice(
      watchdog.indexOf('if worker_unit_installed; then'),
      watchdog.indexOf('# Try health check with retries')
    );

    expect(watchdog).toContain('corgi:ranking-worker:heartbeat:community-gov');
    expect(workerChecks).toContain('systemctl restart "$WORKER_SERVICE"');
    expect(workerChecks).not.toContain('systemctl restart "$SERVICE"');
  });
});

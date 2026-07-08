/**
 * Tests for the disk monitor's escalating disk-freeing actions (PROJ-917).
 *
 * Focus: the emergency tier must NEVER run VACUUM FULL (prod postmortem —
 * it failed ENOSPC 3x against the 21GB `likes` table and starved the pool
 * with an ACCESS EXCLUSIVE lock) and must instead run the free-space-safe
 * action set: partition-manager's drop pass, cleanup's orphan sweeps,
 * journald truncation, CHECKPOINT/WAL check, and a plain VACUUM — plus an
 * escalating system_status alert.
 *
 * Follows the interaction-aggregator.test.ts pattern: start/stop the
 * monitor to exercise the private runDiskCheck() loop, since it isn't
 * exported directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  statfsMock,
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  clientReleaseMock,
  execFileMock,
  triggerManualCleanupMock,
  runPartitionMaintenanceNowMock,
  loggerWarnMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  statfsMock: vi.fn(),
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  execFileMock: vi.fn((_cmd: string, _args: string[], cb?: (err?: Error | null) => void) => cb?.(null)),
  triggerManualCleanupMock: vi.fn(),
  runPartitionMaintenanceNowMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  statfs: statfsMock,
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: vi.fn(),
  },
}));

vi.mock('../src/config.js', () => ({
  config: {
    DISK_WARNING_PERCENT: 80,
    DISK_CRITICAL_PERCENT: 90,
    DISK_EMERGENCY_PERCENT: 95,
  },
}));

vi.mock('../src/maintenance/cleanup.js', () => ({
  triggerManualCleanup: triggerManualCleanupMock,
}));

vi.mock('../src/maintenance/partition-manager.js', () => ({
  runPartitionMaintenanceNow: runPartitionMaintenanceNowMock,
}));

import {
  startDiskMonitor,
  stopDiskMonitor,
  getDiskStatus,
  runEmergencyDiskFreeingActions,
} from '../src/maintenance/disk-monitor.js';

/** Build a fake fs.statfs() result that resolves to the given used_percent
 *  (bsize=1 keeps the arithmetic trivial: blocks=100 == 100% of "capacity"). */
function mockStatfsPercent(usedPercent: number): void {
  const bavail = 100 - usedPercent;
  statfsMock.mockImplementation(
    (_path: string, cb: (err: Error | null, stats?: { blocks: number; bsize: number; bavail: number }) => void) => {
      cb(null, { blocks: 100, bsize: 1, bavail });
    }
  );
}

describe('disk monitor emergency actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock,
    });
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('pg_total_relation_size')) {
        return { rows: [{ size_bytes: '1000000' }] };
      }
      if (typeof sql === 'string' && sql.includes('pg_ls_waldir')) {
        return { rows: [{ wal_bytes: '0' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    triggerManualCleanupMock.mockResolvedValue({ postsDeleted: 0 });
    runPartitionMaintenanceNowMock.mockResolvedValue({ partitionsDropped: [] });
  });

  afterEach(async () => {
    await stopDiskMonitor();
  });

  it('takes no action below the warning threshold', async () => {
    mockStatfsPercent(50);

    await startDiskMonitor();

    expect(getDiskStatus()?.level).toBe('ok');
    expect(triggerManualCleanupMock).not.toHaveBeenCalled();
    expect(runPartitionMaintenanceNowMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining('VACUUM'));
  });

  it('runs cleanup + journald truncation + WAL check at the critical tier (but not partition drop or VACUUM)', async () => {
    mockStatfsPercent(92);

    await startDiskMonitor();

    expect(getDiskStatus()?.level).toBe('critical');
    expect(triggerManualCleanupMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith('journalctl', ['--vacuum-size=500M'], expect.any(Function));
    expect(runPartitionMaintenanceNowMock).not.toHaveBeenCalled();

    const vacuumCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).startsWith('VACUUM')
    );
    expect(vacuumCalls).toHaveLength(0);
  });

  it('never runs VACUUM FULL at the emergency tier, and runs the full free-space-safe action set', async () => {
    mockStatfsPercent(97);

    await startDiskMonitor();

    expect(getDiskStatus()?.level).toBe('emergency');

    // 1. partition-manager drop + cleanup orphan sweeps
    expect(runPartitionMaintenanceNowMock).toHaveBeenCalledTimes(1);
    expect(triggerManualCleanupMock).toHaveBeenCalledTimes(1);

    // 2. journald truncation
    expect(execFileMock).toHaveBeenCalledWith('journalctl', ['--vacuum-size=500M'], expect.any(Function));

    // 4. plain VACUUM per emergency table, NEVER VACUUM FULL
    const allSql = clientQueryMock.mock.calls.map((call: unknown[]) => call[0] as string);
    const fullVacuumCalls = allSql.filter((sql) => /VACUUM\s+FULL/i.test(sql));
    expect(fullVacuumCalls).toHaveLength(0);

    for (const table of ['follows', 'reposts', 'likes', 'posts']) {
      expect(allSql).toContain(`VACUUM ${table}`);
    }

    // 5. escalating alert stored in system_status + error-logged
    const alertCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes("'disk_emergency_alert'")
    );
    expect(alertCall).toBeDefined();
    const alertParams = (alertCall as unknown[])[1] as string[];
    const alertPayload = JSON.parse(alertParams[0]);
    expect(alertPayload.severity).toBe('elevated');
    expect(alertPayload.consecutive_checks).toBe(1);
  });

  it('escalates alert severity on repeated consecutive emergency checks within one monitor lifetime', async () => {
    vi.useFakeTimers();
    mockStatfsPercent(97);

    await startDiskMonitor(); // 1st check: consecutive=1 => elevated
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 2nd check: consecutive=2 => high
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 3rd check: consecutive=3 => critical

    const alertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes("'disk_emergency_alert'")
    );
    expect(alertCalls.length).toBeGreaterThanOrEqual(3);

    const severities = alertCalls.map((call: unknown[]) => JSON.parse((call[1] as string[])[0]).severity);
    expect(severities.slice(0, 3)).toEqual(['elevated', 'high', 'critical']);

    vi.useRealTimers();
  });

  it('clears the emergency alert key once usage drops back to ok', async () => {
    mockStatfsPercent(50);
    await startDiskMonitor();

    const deleteCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM system_status') &&
        (call[0] as string).includes("'disk_emergency_alert'")
    );
    expect(deleteCall).toBeDefined();
  });

  it('clears the emergency alert key at the warning tier', async () => {
    mockStatfsPercent(85); // warning: 80-90%
    await startDiskMonitor();

    const deleteCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM system_status') &&
        (call[0] as string).includes("'disk_emergency_alert'")
    );
    expect(deleteCall).toBeDefined();
  });

  // Thread 20: the old version of this test was titled "...at the warning
  // and critical tiers too" but only ever exercised 85% (warning). This
  // exercises 92%, which is specifically the critical tier (90-95%), and
  // pins down that clearEmergencyAlert() fires there too (runDiskCheck's
  // critical branch calls it after triggerManualCleanup/truncateJournald/
  // checkWalSize).
  it('clears the emergency alert key at the critical tier', async () => {
    mockStatfsPercent(92); // critical: 90-95%
    await startDiskMonitor();

    expect(getDiskStatus()?.level).toBe('critical');

    const deleteCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM system_status') &&
        (call[0] as string).includes("'disk_emergency_alert'")
    );
    expect(deleteCall).toBeDefined();
  });

  // Thread 19 (1/3): isEmergencyActionRunning is the guard added specifically
  // to prevent a second emergency pass from starting mid-flight. Under the
  // normal scheduled path, runDiskCheck()'s own isChecking flag already fully
  // serializes checks (startDiskMonitor() awaits the first check before ever
  // registering the interval), so there is no way to reach a genuinely
  // overlapping call through the public start/stop API. Exercise the guard
  // directly against the (now-exported) function instead.
  it('runEmergencyDiskFreeingActions skips a second overlapping invocation instead of running twice', async () => {
    let resolvePartitionMaintenance: (() => void) | undefined;
    runPartitionMaintenanceNowMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePartitionMaintenance = () => resolve({ partitionsDropped: [] });
        })
    );

    // Both calls are issued before either awaits anything: the first call's
    // synchronous prefix (the isEmergencyActionRunning check-and-set) runs to
    // completion before control returns to this test, so the second call
    // deterministically observes the guard already engaged.
    const firstCall = runEmergencyDiskFreeingActions();
    const secondCall = runEmergencyDiskFreeingActions();

    await secondCall;

    expect(runPartitionMaintenanceNowMock).toHaveBeenCalledTimes(1);
    expect(triggerManualCleanupMock).not.toHaveBeenCalled(); // still blocked behind the pending partition-maintenance call
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('already running')
    );

    // Unblock the first call so it completes and doesn't leak a pending
    // promise/timer into the next test.
    resolvePartitionMaintenance?.();
    await firstCall;

    expect(runPartitionMaintenanceNowMock).toHaveBeenCalledTimes(1);
    expect(triggerManualCleanupMock).toHaveBeenCalledTimes(1);
  });

  // Thread 19 (2/3): a failure on one table's VACUUM must not abort the rest
  // of the emergency pass -- this also regression-tests the per-table
  // try/catch fix in runEmergencyPlainVacuum (previously a single outer
  // try/catch meant one failing table silently skipped every table after it).
  it('continues vacuuming the remaining tables when one VACUUM call fails at the emergency tier', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('pg_total_relation_size')) {
        return { rows: [{ size_bytes: '1000000' }] };
      }
      if (typeof sql === 'string' && sql.includes('pg_ls_waldir')) {
        return { rows: [{ wal_bytes: '0' }] };
      }
      if (typeof sql === 'string' && sql === 'VACUUM likes') {
        throw new Error('simulated VACUUM failure');
      }
      return { rows: [], rowCount: 0 };
    });

    mockStatfsPercent(97);
    await startDiskMonitor();

    const vacuumCalls = clientQueryMock.mock.calls
      .map((call: unknown[]) => call[0] as string)
      .filter((sql) => /^VACUUM\s+\w+$/.test(sql));

    // All four tables were still attempted, including the ones after the
    // failing "likes" table in EMERGENCY_VACUUM_TABLES (follows, reposts,
    // likes, posts) -- "posts" specifically proves the loop didn't stop.
    for (const table of ['follows', 'reposts', 'likes', 'posts']) {
      expect(vacuumCalls).toContain(`VACUUM ${table}`);
    }
  });

  // Thread 19 (3/3): execFileMock always calls back with success in every
  // other test; nothing exercises the err branch that logs a warning and
  // continues (truncateJournald must not throw / abort the check).
  it('logs a warning and continues when journald truncation fails', async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], cb?: (err?: Error | null) => void) =>
        cb?.(new Error('journalctl: permission denied'))
    );

    mockStatfsPercent(92); // critical tier also runs truncateJournald()

    await expect(startDiskMonitor()).resolves.toBeUndefined();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Failed to truncate journald')
    );
    expect(getDiskStatus()?.level).toBe('critical');
  });
});

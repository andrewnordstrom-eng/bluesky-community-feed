import { monitorEventLoopDelay } from 'node:perf_hooks';
import { redis } from '../../src/db/redis.js';
import { runFeedSkeletonStressMode } from './feed-skeleton.stress.js';

interface ChildOptions {
  mode: 'normal' | 'noop';
  amount: number;
  connections: number;
}

interface ChildMemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
}

function readFlagValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new RangeError(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInteger(raw: string | null, fallback: number, name: string): number {
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${name} must be a positive integer; received ${raw}`);
  }
  return parsed;
}

function parseOptions(args: readonly string[]): ChildOptions {
  const mode = readFlagValue(args, '--mode');
  if (mode !== 'normal' && mode !== 'noop') {
    throw new RangeError(`--mode must be normal or noop; received ${mode}`);
  }
  return {
    mode,
    amount: parsePositiveInteger(readFlagValue(args, '--amount'), 10_000, '--amount'),
    connections: parsePositiveInteger(readFlagValue(args, '--connections'), 100, '--connections'),
  };
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function snapshot(): ChildMemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rssMb: mb(usage.rss),
    heapUsedMb: mb(usage.heapUsed),
    heapTotalMb: mb(usage.heapTotal),
    externalMb: mb(usage.external),
  };
}

function requireGc(): () => void {
  const gc = globalThis.gc;
  if (typeof gc !== 'function') {
    throw new Error('global.gc is unavailable; run child process with node --expose-gc');
  }
  return gc;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const gc = requireGc();
  gc();
  const before = snapshot();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const result = await runFeedSkeletonStressMode(options.mode === 'noop', options.amount, options.connections);
  gc();
  const afterGc = snapshot();
  eventLoop.disable();

  const payload = `${JSON.stringify({
      mode: options.mode,
      amount: options.amount,
      connections: options.connections,
      before,
      afterGc,
      afterGcDeltaMb: Math.round((afterGc.rssMb - before.rssMb) * 100) / 100,
      heapUsedAfterGcDeltaMb: Math.round((afterGc.heapUsedMb - before.heapUsedMb) * 100) / 100,
      eventLoopDelayP95Ms: Math.round((eventLoop.percentile(95) / 1_000_000) * 100) / 100,
      result,
    })}\n`;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  redis.disconnect();
  process.exit(result.success ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  redis.disconnect();
  process.exit(1);
});

import { performance } from 'node:perf_hooks';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpLoadRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface HttpLoadOptions {
  baseUrl: string;
  amount: number | null;
  durationMs: number | null;
  connections: number;
  timeoutMs: number;
  requests: readonly HttpLoadRequest[];
}

export interface LatencyStats {
  min: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  average: number;
  max: number;
}

export interface RateStats {
  average: number;
  min: number;
  max: number;
  total: number;
}

export interface StatusBuckets {
  s1xx: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  other: number;
}

export interface HttpLoadResult {
  latency: LatencyStats;
  requests: RateStats;
  throughput: RateStats;
  errors: number;
  timeouts: number;
  non2xx: number;
  statusBuckets: StatusBuckets;
}

interface MutableCounters {
  sent: number;
  bytes: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  latenciesMs: number[];
  completionOffsetsMs: number[];
  completionBytes: number[];
  statusBuckets: StatusBuckets;
}

function emptyStatusBuckets(): StatusBuckets {
  return {
    s1xx: 0,
    s2xx: 0,
    s3xx: 0,
    s4xx: 0,
    s5xx: 0,
    other: 0,
  };
}

function roundNumber(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function assertLoadOptions(options: HttpLoadOptions): void {
  if (options.connections < 1 || !Number.isInteger(options.connections)) {
    throw new RangeError(`connections must be a positive integer; received ${options.connections}`);
  }

  if (options.timeoutMs < 1 || !Number.isInteger(options.timeoutMs)) {
    throw new RangeError(`timeoutMs must be a positive integer; received ${options.timeoutMs}`);
  }

  if (options.requests.length === 0) {
    throw new RangeError('requests must include at least one request template');
  }

  if (options.amount === null && options.durationMs === null) {
    throw new RangeError('either amount or durationMs must be provided');
  }

  if (options.amount !== null && (options.amount < 1 || !Number.isInteger(options.amount))) {
    throw new RangeError(`amount must be a positive integer when provided; received ${options.amount}`);
  }

  if (options.durationMs !== null && (options.durationMs < 1 || !Number.isInteger(options.durationMs))) {
    throw new RangeError(`durationMs must be a positive integer when provided; received ${options.durationMs}`);
  }
}

function nextRequestIndex(
  counters: MutableCounters,
  amount: number | null,
  deadlineMs: number | null,
  nowMs: number
): number | null {
  if (deadlineMs !== null && nowMs >= deadlineMs) {
    return null;
  }

  if (amount !== null && counters.sent >= amount) {
    return null;
  }

  const requestIndex = counters.sent;
  counters.sent += 1;
  return requestIndex;
}

function addStatus(statusBuckets: StatusBuckets, status: number): void {
  if (status >= 100 && status < 200) {
    statusBuckets.s1xx += 1;
    return;
  }

  if (status >= 200 && status < 300) {
    statusBuckets.s2xx += 1;
    return;
  }

  if (status >= 300 && status < 400) {
    statusBuckets.s3xx += 1;
    return;
  }

  if (status >= 400 && status < 500) {
    statusBuckets.s4xx += 1;
    return;
  }

  if (status >= 500 && status < 600) {
    statusBuckets.s5xx += 1;
    return;
  }

  statusBuckets.other += 1;
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const rank = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  const boundedRank = Math.max(0, Math.min(sortedValues.length - 1, rank));
  return roundNumber(sortedValues[boundedRank], 2);
}

function summarizeLatency(latenciesMs: readonly number[]): LatencyStats {
  if (latenciesMs.length === 0) {
    return {
      min: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p999: 0,
      average: 0,
      max: 0,
    };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    min: roundNumber(sorted[0], 2),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    p999: percentile(sorted, 99.9),
    average: roundNumber(total / sorted.length, 2),
    max: roundNumber(sorted[sorted.length - 1], 2),
  };
}

export function summarizeRate(
  total: number,
  completionOffsetsMs: readonly number[],
  elapsedMs: number,
  weights: readonly number[] | null
): RateStats {
  if (weights !== null && weights.length !== completionOffsetsMs.length) {
    throw new RangeError(
      `weights length must match completion offsets length; received ${weights.length} weights for ${completionOffsetsMs.length} offsets`
    );
  }

  const elapsedSeconds = Math.max(elapsedMs / 1000, 0.001);
  const bucketCount = Math.max(1, Math.ceil(elapsedSeconds));
  const buckets = Array.from({ length: bucketCount }, () => 0);
  let weightedTotal = 0;

  for (const [index, offsetMs] of completionOffsetsMs.entries()) {
    const weight = weights === null ? 1 : weights[index];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`rate weight must be a non-negative finite number; received ${weight} at index ${index}`);
    }

    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor(offsetMs / 1000)));
    buckets[bucketIndex] += weight;
    weightedTotal += weight;
  }

  const effectiveTotal = weights === null ? total : weightedTotal;

  return {
    average: roundNumber(effectiveTotal / elapsedSeconds, 2),
    min: Math.min(...buckets),
    max: Math.max(...buckets),
    total: effectiveTotal,
  };
}

function formatRequestUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function executeRequest(
  baseUrl: string,
  request: HttpLoadRequest,
  timeoutMs: number,
  runStartedAtMs: number,
  counters: MutableCounters
): Promise<void> {
  const requestStartedAtMs = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let responseBytes = 0;

  try {
    const response = await fetch(formatRequestUrl(baseUrl, request.path), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    responseBytes = body.byteLength;
    counters.bytes += responseBytes;
    addStatus(counters.statusBuckets, response.status);

    if (response.status < 200 || response.status >= 300) {
      counters.non2xx += 1;
    }
  } catch (error: unknown) {
    if (isAbortError(error)) {
      counters.timeouts += 1;
    } else {
      counters.errors += 1;
    }
  } finally {
    clearTimeout(timeout);
    const completedAtMs = performance.now();
    counters.latenciesMs.push(roundNumber(completedAtMs - requestStartedAtMs, 2));
    counters.completionOffsetsMs.push(completedAtMs - runStartedAtMs);
    counters.completionBytes.push(responseBytes);
  }
}

async function runWorker(options: HttpLoadOptions, startedAtMs: number, counters: MutableCounters): Promise<void> {
  const deadlineMs = options.durationMs === null ? null : startedAtMs + options.durationMs;

  while (true) {
    const requestIndex = nextRequestIndex(counters, options.amount, deadlineMs, performance.now());
    if (requestIndex === null) {
      return;
    }

    const request = options.requests[requestIndex % options.requests.length];
    await executeRequest(options.baseUrl, request, options.timeoutMs, startedAtMs, counters);
  }
}

export async function runHttpLoad(options: HttpLoadOptions): Promise<HttpLoadResult> {
  assertLoadOptions(options);

  const startedAtMs = performance.now();
  const counters: MutableCounters = {
    sent: 0,
    bytes: 0,
    errors: 0,
    timeouts: 0,
    non2xx: 0,
    latenciesMs: [],
    completionOffsetsMs: [],
    completionBytes: [],
    statusBuckets: emptyStatusBuckets(),
  };

  const workers = Array.from({ length: options.connections }, () => runWorker(options, startedAtMs, counters));
  await Promise.all(workers);

  const elapsedMs = performance.now() - startedAtMs;

  return {
    latency: summarizeLatency(counters.latenciesMs),
    requests: summarizeRate(counters.sent, counters.completionOffsetsMs, elapsedMs, null),
    throughput: summarizeRate(counters.bytes, counters.completionOffsetsMs, elapsedMs, counters.completionBytes),
    errors: counters.errors,
    timeouts: counters.timeouts,
    non2xx: counters.non2xx,
    statusBuckets: counters.statusBuckets,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${roundNumber(bytes / 1024, 2)} KB`;
  }

  return `${roundNumber(bytes / (1024 * 1024), 2)} MB`;
}

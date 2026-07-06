import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runHttpLoad, summarizeRate, type HttpLoadOptions, type HttpLoadRequest } from '../scripts/http-load.js';

const execFileAsync = promisify(execFile);
const LOAD_TEST_SCRIPT = path.resolve('scripts', 'load-test.ts');
const TSX_LOADER = path.resolve('node_modules', 'tsx', 'dist', 'loader.mjs');
const getRequest: HttpLoadRequest = {
  method: 'GET',
  path: '/',
  headers: {},
  body: null,
};
const validLoadOptions: HttpLoadOptions = {
  baseUrl: 'http://example.com',
  amount: 1,
  durationMs: null,
  connections: 1,
  timeoutMs: 1_000,
  requests: [getRequest],
};

async function expectRangeError(options: HttpLoadOptions): Promise<void> {
  await expect(runHttpLoad(options)).rejects.toThrow(RangeError);
}

async function withHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`expected TCP server address; received ${String(address)}`);
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe('summarizeRate', () => {
  it('computes throughput buckets from response bytes instead of completion counts', () => {
    const completionOffsetsMs = [10, 20, 1_010, 1_020];
    const requestRate = summarizeRate(4, completionOffsetsMs, 2_000, null);
    const throughput = summarizeRate(0, completionOffsetsMs, 2_000, [100, 100, 10_240, 10_240]);

    expect(requestRate).toEqual({
      average: 2,
      min: 2,
      max: 2,
      total: 4,
    });
    expect(throughput).toEqual({
      average: 10_340,
      min: 200,
      max: 20_480,
      total: 20_680,
    });
  });

  it('reports zero throughput when every completed request has no response bytes', () => {
    const throughput = summarizeRate(0, [10, 20, 30], 1_000, [0, 0, 0]);

    expect(throughput).toEqual({
      average: 0,
      min: 0,
      max: 0,
      total: 0,
    });
  });

  it('keeps uniform-size throughput proportional to request counts', () => {
    const completionOffsetsMs = [10, 20, 1_010, 1_020];
    const requestRate = summarizeRate(4, completionOffsetsMs, 2_000, null);
    const throughput = summarizeRate(0, completionOffsetsMs, 2_000, [512, 512, 512, 512]);

    expect(throughput.total).toBe(requestRate.total * 512);
    expect(throughput.min).toBe(requestRate.min * 512);
    expect(throughput.max).toBe(requestRate.max * 512);
  });

  it('reports zeros for empty weighted samples', () => {
    expect(summarizeRate(0, [], 1_000, [])).toEqual({
      average: 0,
      min: 0,
      max: 0,
      total: 0,
    });
  });

  it('fails fast when weighted samples do not align with completion offsets', () => {
    expect(() => summarizeRate(0, [10, 20], 1_000, [100])).toThrow(RangeError);
    expect(() => summarizeRate(0, [10], 1_000, [-1])).toThrow(RangeError);
    expect(() => summarizeRate(0, [10], 1_000, [Number.NaN])).toThrow(RangeError);
    expect(() => summarizeRate(0, [10], 1_000, [Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe('runHttpLoad option validation', () => {
  it('rejects malformed baseUrl before workers start', async () => {
    await expect(
      runHttpLoad({
        baseUrl: 'http://example .com',
        amount: 1,
        durationMs: null,
        connections: 1,
        timeoutMs: 1_000,
        requests: [getRequest],
      })
    ).rejects.toThrow(RangeError);
  });

  it('rejects non-http baseUrl before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      baseUrl: 'ftp://example.com',
    });
  });

  it('rejects malformed request paths before workers start', async () => {
    await expect(
      runHttpLoad({
        baseUrl: 'http://example.com',
        amount: 1,
        durationMs: null,
        connections: 1,
        timeoutMs: 1_000,
        requests: [
          {
            method: 'GET',
            path: '//[',
            headers: {},
            body: null,
          },
        ],
      })
    ).rejects.toThrow(RangeError);
  });

  it('rejects request paths that resolve to non-http URLs before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      requests: [
        {
          method: 'GET',
          path: 'mailto:test@example.com',
          headers: {},
          body: null,
        },
      ],
    });
  });
});

describe('runHttpLoad validation boundary cases', () => {
  it('rejects zero connections before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      connections: 0,
    });
  });

  it('rejects zero timeoutMs before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      timeoutMs: 0,
    });
  });

  it('rejects zero amount before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      amount: 0,
      durationMs: null,
    });
  });

  it('rejects zero durationMs before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      amount: null,
      durationMs: 0,
    });
  });

  it('rejects empty request templates before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      requests: [],
    });
  });

  it('rejects missing amount and duration before workers start', async () => {
    await expectRangeError({
      ...validLoadOptions,
      amount: null,
      durationMs: null,
    });
  });
});

describe('runHttpLoad execution', () => {
  it('allocates exactly amount requests across concurrent workers', async () => {
    let requestCount = 0;

    await withHttpServer(
      (_request, response) => {
        requestCount += 1;
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 7,
          durationMs: null,
          connections: 3,
          timeoutMs: 1_000,
          requests: [getRequest],
        });

        expect(requestCount).toBe(7);
        expect(result.requests.total).toBe(7);
        expect(result.statusBuckets.s2xx).toBe(7);
      }
    );
  });

  it('stops duration-based runs after the configured deadline', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
      },
      async (baseUrl) => {
        const startedAtMs = performance.now();
        const result = await runHttpLoad({
          baseUrl,
          amount: null,
          durationMs: 100,
          connections: 2,
          timeoutMs: 100,
          requests: [getRequest],
        });
        const elapsedMs = performance.now() - startedAtMs;

        expect(elapsedMs).toBeGreaterThanOrEqual(90);
        expect(elapsedMs).toBeLessThan(1_000);
        expect(result.requests.total).toBeGreaterThan(0);
      }
    );
  });

  it('counts timeout responses without marking them successful', async () => {
    await withHttpServer(
      (_request, response) => {
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('slow');
        }, 50);
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 10,
          requests: [getRequest],
        });

        expect(result.requests.total).toBe(1);
        expect(result.statusBuckets.s2xx).toBe(0);
        expect(result.timeouts).toBe(1);
        expect(result.errors).toBe(0);
      }
    );
  });

  it('counts non-2xx responses in status buckets and non2xx totals', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('unavailable');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [getRequest],
        });

        expect(result.requests.total).toBe(1);
        expect(result.statusBuckets.s5xx).toBe(1);
        expect(result.non2xx).toBe(1);
        expect(result.errors).toBe(0);
      }
    );
  });

  it('keeps expected non-2xx responses out of failure counters', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(429, { 'content-type': 'text/plain' });
        response.end('rate limited');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [{ ...getRequest, expectedStatuses: [429] }],
        });

        expect(result.requests.total).toBe(1);
        expect(result.statusBuckets.s4xx).toBe(1);
        expect(result.statusCodes).toEqual({ '429': 1 });
        expect(result.non2xx).toBe(0);
        expect(result.unexpectedStatuses).toBe(0);
      }
    );
  });

  it('counts unexpected statuses against explicit expectations', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('unavailable');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [{ ...getRequest, expectedStatuses: [429] }],
        });

        expect(result.statusBuckets.s5xx).toBe(1);
        expect(result.statusCodes).toEqual({ '503': 1 });
        expect(result.non2xx).toBe(1);
        expect(result.unexpectedStatuses).toBe(1);
      }
    );
  });

  it('flags unexpected 2xx responses without incrementing non2xx', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(201, { 'content-type': 'text/plain' });
        response.end('created');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [{ ...getRequest, expectedStatuses: [200] }],
        });

        expect(result.statusBuckets.s2xx).toBe(1);
        expect(result.non2xx).toBe(0);
        expect(result.unexpectedStatuses).toBe(1);
      }
    );
  });

  it('rejects empty expected status lists', async () => {
    await expect(
      runHttpLoad({
        baseUrl: 'http://127.0.0.1:65535',
        amount: 1,
        durationMs: null,
        connections: 1,
        timeoutMs: 1_000,
        requests: [{ ...getRequest, expectedStatuses: [] }],
      })
    ).rejects.toThrow(RangeError);
  });

  it.each([99, 600, 200.5])('rejects invalid expected status %s', async (status) => {
    await expect(
      runHttpLoad({
        baseUrl: 'http://127.0.0.1:65535',
        amount: 1,
        durationMs: null,
        connections: 1,
        timeoutMs: 1_000,
        requests: [{ ...getRequest, expectedStatuses: [status] }],
      })
    ).rejects.toThrow(RangeError);
  });

  it('accepts expected status validation boundaries', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [{ ...getRequest, expectedStatuses: [100, 599] }],
        });

        expect(result.requests.total).toBe(1);
        expect(result.unexpectedStatuses).toBe(1);
      }
    );
  });

  it('load-test CLI terminates promptly after printing the result', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ feed: [] }));
      },
      async (baseUrl) => {
        const result = await execFileAsync(
          process.execPath,
          [
            '--import',
            TSX_LOADER,
            LOAD_TEST_SCRIPT,
            '--url',
            baseUrl,
            '--connections',
            '1',
            '--duration',
            '1',
            '--target',
            '10000',
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              FEED_URI: 'at://did:plc:loadtest/app.bsky.feed.generator/community-gov',
            },
            timeout: 8_000,
          }
        );

        expect(result.stdout).toContain('PASS:');
        expect(result.stderr).toBe('');
      }
    );
  });

  it('counts transport failures without marking them successful', async () => {
    await withHttpServer(
      (_request, response) => {
        response.destroy(new Error('intentional transport reset'));
      },
      async (baseUrl) => {
        const result = await runHttpLoad({
          baseUrl,
          amount: 1,
          durationMs: null,
          connections: 1,
          timeoutMs: 1_000,
          requests: [getRequest],
        });

        expect(result.requests.total).toBe(1);
        expect(result.statusBuckets.s2xx).toBe(0);
        expect(result.errors).toBe(1);
        expect(result.timeouts).toBe(0);
      }
    );
  });
});

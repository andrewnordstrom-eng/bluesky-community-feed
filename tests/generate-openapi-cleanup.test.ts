import { describe, expect, it, vi } from 'vitest';
import { runWithOpenApiCleanup } from '../scripts/generate-openapi.js';

describe('OpenAPI generator cleanup', () => {
  it('preserves a primary generation error when database and Redis cleanup also fail', async () => {
    const primaryError = new Error('Failed to fetch spec: HTTP 503');
    const databaseCleanup = vi.fn(async () => {
      throw new Error('database cleanup failed');
    });
    const redisCleanup = vi.fn(async () => {
      throw new Error('Redis cleanup failed');
    });
    const reportCleanupFailure = vi.fn<(error: AggregateError) => void>();

    await expect(runWithOpenApiCleanup(
      async () => {
        throw primaryError;
      },
      [databaseCleanup, redisCleanup],
      reportCleanupFailure
    )).rejects.toBe(primaryError);

    expect(databaseCleanup).toHaveBeenCalledTimes(1);
    expect(redisCleanup).toHaveBeenCalledTimes(1);
    expect(reportCleanupFailure).toHaveBeenCalledTimes(1);
    expect(reportCleanupFailure.mock.calls[0]?.[0]).toBeInstanceOf(AggregateError);
    expect(reportCleanupFailure.mock.calls[0]?.[0].errors).toHaveLength(2);
  });

  it('surfaces cleanup failure when generation itself succeeds', async () => {
    await expect(runWithOpenApiCleanup(
      async () => 'generated',
      [async () => {
        throw new Error('cleanup failed');
      }],
      vi.fn()
    )).rejects.toThrow('OpenAPI generator cleanup failed');
  });

  it('returns the generation result after successful cleanup', async () => {
    await expect(runWithOpenApiCleanup(
      async () => 'generated',
      [async () => undefined],
      vi.fn()
    )).resolves.toBe('generated');
  });
});

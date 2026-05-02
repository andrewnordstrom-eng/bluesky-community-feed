import { describe, expect, it } from 'vitest';
import { summarizeRate } from '../scripts/http-load.js';

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

  it('fails fast when weighted samples do not align with completion offsets', () => {
    expect(() => summarizeRate(0, [10, 20], 1_000, [100])).toThrow(RangeError);
  });
});

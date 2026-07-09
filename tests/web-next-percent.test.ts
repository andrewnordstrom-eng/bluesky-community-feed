import { describe, expect, it } from 'vitest';
import {
  absoluteUnitScoreToPercentValue,
  clampPercentValue,
  formatUnitIntervalPercent,
  unitIntervalToPercentValue,
} from '../web-next/lib/percent';

describe('web-next percent helpers', () => {
  it('clamps already-scaled percentages at the lowest level', () => {
    expect(clampPercentValue(Number.NaN)).toBe(0);
    expect(clampPercentValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPercentValue(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampPercentValue(-1)).toBe(0);
    expect(clampPercentValue(0)).toBe(0);
    expect(clampPercentValue(12.5)).toBe(13);
    expect(clampPercentValue(100)).toBe(100);
    expect(clampPercentValue(101)).toBe(100);
  });

  it('keeps unit interval bar widths and labels clamped consistently', () => {
    expect(unitIntervalToPercentValue(0)).toBe(0);
    expect(formatUnitIntervalPercent(0)).toBe('0%');
    expect(unitIntervalToPercentValue(1)).toBe(100);
    expect(formatUnitIntervalPercent(1)).toBe('100%');
    expect(unitIntervalToPercentValue(Number.NaN)).toBe(0);
    expect(formatUnitIntervalPercent(Number.NaN)).toBe('0%');
    expect(unitIntervalToPercentValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(formatUnitIntervalPercent(Number.POSITIVE_INFINITY)).toBe('0%');
    expect(unitIntervalToPercentValue(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(formatUnitIntervalPercent(Number.NEGATIVE_INFINITY)).toBe('0%');
    expect(unitIntervalToPercentValue(1.4)).toBe(100);
    expect(formatUnitIntervalPercent(1.4)).toBe('100%');
    expect(unitIntervalToPercentValue(-0.2)).toBe(0);
    expect(formatUnitIntervalPercent(-0.2)).toBe('0%');
  });

  it('preserves absolute score behavior for score bars', () => {
    expect(absoluteUnitScoreToPercentValue(-0.45)).toBe(45);
    expect(absoluteUnitScoreToPercentValue(1.25)).toBe(100);
    expect(absoluteUnitScoreToPercentValue(Number.NaN)).toBe(0);
  });
});

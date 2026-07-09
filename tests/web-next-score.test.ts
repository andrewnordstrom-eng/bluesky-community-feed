import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatSignedScore, isNonNegativeScore, normalizeScoreValue } from '../web-next/lib/score';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('web-next score helpers', () => {
  it('normalizes non-finite score values before formatting signed receipts', () => {
    expect(normalizeScoreValue(Number.NaN)).toBe(0);
    expect(normalizeScoreValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeScoreValue(Number.NEGATIVE_INFINITY)).toBe(0);

    expect(formatSignedScore(Number.NaN)).toBe('+0.00');
    expect(formatSignedScore(Number.POSITIVE_INFINITY)).toBe('+0.00');
    expect(formatSignedScore(Number.NEGATIVE_INFINITY)).toBe('+0.00');
    expect(formatSignedScore(0.8486208006784361)).toBe('+0.85');
    expect(formatSignedScore(-0.125)).toBe('-0.13');
    expect(formatSignedScore(0)).toBe('+0.00');
    expect(formatSignedScore(-0)).toBe('+0.00');

    expect(isNonNegativeScore(Number.NaN)).toBe(true);
    expect(isNonNegativeScore(-0.01)).toBe(false);
  });

  it('keeps homepage receipt score formatting on the shared helper', () => {
    const bentoContent = readRepoFile('web-next/components/bento-section.tsx');
    const dashboardContent = readRepoFile('web-next/components/dashboard-preview.tsx');

    expect(bentoContent).not.toContain('function formatScore');
    expect(bentoContent).toContain('formatSignedScore(LIVE_RANK_ONE_EXPLANATION.totalScore)');
    expect(dashboardContent).not.toContain('totalScorePrefix');
    expect(dashboardContent).toContain('formatSignedScore(LIVE_RANK_ONE_EXPLANATION.totalScore)');
  });
});

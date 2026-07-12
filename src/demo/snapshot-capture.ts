import type { DemoFetchFunction } from './appview.js';
import type { PostScoreRecord } from '../scoring/score-reader.js';

export function createBoundedDemoFetch(timeoutMs: number): DemoFetchFunction {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Demo snapshot AppView timeout must be positive and finite: ${timeoutMs}`);
  }
  return async (input, init) => {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(init.signal.reason);
    if (init.signal.aborted) {
      forwardAbort();
    } else {
      init.signal.addEventListener('abort', forwardAbort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error(`AppView request exceeded ${timeoutMs} ms`)), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      init.signal.removeEventListener('abort', forwardAbort);
    }
  };
}

export function scoreCompletenessRate(
  scores: ReadonlyArray<PostScoreRecord | null>,
  expectedCount: number
): number {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`Demo snapshot score denominator must be a non-negative integer: ${expectedCount}`);
  }
  const complete = scores.filter(hasCompleteScoreDecomposition).length;
  if (complete > expectedCount) {
    throw new Error(`Demo snapshot completeness numerator ${complete} exceeds denominator ${expectedCount}`);
  }
  if (expectedCount === 0) return 0;
  return Number((complete / expectedCount).toFixed(6));
}

export function canonicalizeFrozenEmbedUrl(value: string | null): string | null {
  if (value === null) return null;
  const url = new URL(value);
  if (url.protocol === 'http:') return null;
  if (url.protocol !== 'https:') {
    throw new Error(`Demo snapshot embed URL must use HTTPS: ${url.protocol}`);
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function hasCompleteScoreDecomposition(score: PostScoreRecord | null): score is PostScoreRecord {
  if (!score) return false;
  return ['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'].every((key) => {
    const component = score.components[key];
    return component !== undefined
      && Number.isFinite(component.raw)
      && Number.isFinite(component.weight)
      && Number.isFinite(component.weighted);
  });
}

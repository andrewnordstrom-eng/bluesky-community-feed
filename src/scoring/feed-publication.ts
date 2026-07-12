export interface FeedPublicationCandidate<TValue> {
  id: string;
  score: number;
  embedUrl: string | null;
  textLength: number;
  value: TValue;
}

export interface FeedPublicationEntry<TValue> extends FeedPublicationCandidate<TValue> {
  publicationAdjustment: number;
}

export interface FeedUrlDedupResult<TValue> {
  entries: FeedPublicationEntry<TValue>[];
  dedupedUrlCount: number;
  totalUrlCount: number;
}

export const FEED_URL_DEDUP_DECAY = [1, 0.7, 0.5, 0.3] as const;

export function applyFeedUrlDedup<TValue>(
  orderedCandidates: readonly FeedPublicationCandidate<TValue>[],
  options: {
    enabled: boolean;
    minimumOriginalTextLength: number;
    decay: readonly number[];
  }
): FeedUrlDedupResult<TValue> {
  if (!Number.isFinite(options.minimumOriginalTextLength) || options.minimumOriginalTextLength < 0) {
    throw new Error(`Feed URL dedup minimumOriginalTextLength must be finite and non-negative: ${options.minimumOriginalTextLength}`);
  }
  if (options.decay.length === 0 || options.decay.some((value) => !Number.isFinite(value) || value <= 0 || value > 1)) {
    throw new Error('Feed URL dedup decay must contain finite values in (0, 1]');
  }
  const urlCounts = new Map<string, number>();
  const entries = orderedCandidates.map((candidate) => {
    let publicationAdjustment = 1;
    if (options.enabled && candidate.embedUrl && candidate.textLength < options.minimumOriginalTextLength) {
      const count = urlCounts.get(candidate.embedUrl) ?? 0;
      urlCounts.set(candidate.embedUrl, count + 1);
      publicationAdjustment = options.decay[Math.min(count, options.decay.length - 1)];
    }
    return {
      ...candidate,
      score: candidate.score * publicationAdjustment,
      publicationAdjustment,
    };
  });
  entries.sort((left, right) => right.score - left.score);
  return {
    entries,
    dedupedUrlCount: [...urlCounts.values()].filter((count) => count > 1).length,
    totalUrlCount: urlCounts.size,
  };
}

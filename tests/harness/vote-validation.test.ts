/**
 * Vote-Validation Shim Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency. Exercises
 * `validateVote` (src/harness/vote-validation.ts) directly against the same
 * kinds of payloads `POST /api/governance/vote` (src/governance/routes/
 * vote.ts) would see, without needing a live route/server — the whole point
 * of this shim is that it reproduces that route's decision without one.
 */

import { describe, expect, it } from 'vitest';
import { validateVote, type RawVotePayload, type VoteValidationContext } from '../../src/harness/vote-validation.js';

const VOTER = 'did:plc:corgisimvalidvoter000000';

function buildCtx(overrides: Partial<VoteValidationContext> = {}): VoteValidationContext {
  return {
    subscriberDids: new Set([VOTER]),
    activeTopicSlugs: new Set(['software-development', 'sports', 'music', 'science', 'politics']),
    epochPhase: 'voting',
    ...overrides,
  };
}

/** A fully valid weight-only vote: 5 registered components summing to 1. */
function validWeightPayload(overrides: Partial<RawVotePayload> = {}): RawVotePayload {
  return {
    voterDid: VOTER,
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    ...overrides,
  };
}

describe('validateVote: accepts route-valid votes', () => {
  it('accepts a valid weight-only vote', () => {
    const result = validateVote(validWeightPayload(), buildCtx());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.weights).toEqual({
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.2,
        relevance: 0.2,
      });
      expect(result.data.topicWeights).toBeNull();
    }
  });

  it('accepts a valid keyword-only vote (no weights, no topic weights)', () => {
    const result = validateVote(
      { voterDid: VOTER, include_keywords: ['tech'], exclude_keywords: ['spam'] },
      buildCtx()
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.weights).toBeNull();
      expect(result.data.includeKeywords).toEqual(['tech']);
      expect(result.data.excludeKeywords).toEqual(['spam']);
    }
  });

  it('accepts a valid topic-weight-only vote (no component weights, no keywords)', () => {
    const result = validateVote(
      { voterDid: VOTER, topic_weights: { sports: 0.8, music: 0.3 } },
      buildCtx()
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.weights).toBeNull();
      expect(result.data.topicWeights).toEqual({ sports: 0.8, music: 0.3 });
    }
  });

  it('accepts a vote combining weights, keywords, and topic weights', () => {
    const result = validateVote(
      { ...validWeightPayload(), include_keywords: ['news'], topic_weights: { politics: 0.6 } },
      buildCtx()
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a weight vote whose raw sum is within the 0.01 tolerance but not exactly 1.0", () => {
    // The prior version used offsetting +0.005/-0.005 deviations that summed to
    // exactly 1.0, so it never actually exercised the tolerance branch. This
    // sums to 1.005 — genuinely off from 1.0, but inside |sum - 1| < 0.01.
    const result = validateVote(validWeightPayload({ recency_weight: 0.205 }), buildCtx());
    expect(result.valid).toBe(true);
  });

  it('accepts the inclusive topic-weight boundaries: exactly 0 and exactly 1', () => {
    // The topic-weight bound is `.min(0).max(1)` (inclusive); cover the edges,
    // not just the over-range reject, so an accidental `.lt`/`.gt` regression fails.
    expect(validateVote({ voterDid: VOTER, topic_weights: { sports: 0 } }, buildCtx()).valid).toBe(true);
    expect(validateVote({ voterDid: VOTER, topic_weights: { sports: 1 } }, buildCtx()).valid).toBe(true);
  });

  it('accepts a keyword at the inclusive length and count limits (50 chars, 20 keywords)', () => {
    // `.max(50)` / `.max(20)` are inclusive — an off-by-one (e.g. `.max(49)`)
    // would slip through if only the over-limit reject cases were tested.
    expect(
      validateVote({ voterDid: VOTER, include_keywords: ['a'.repeat(50)] }, buildCtx()).valid
    ).toBe(true);
    expect(
      validateVote(
        { voterDid: VOTER, include_keywords: Array.from({ length: 20 }, (_, i) => `kw${i}`) },
        buildCtx()
      ).valid
    ).toBe(true);
  });
});

describe('validateVote: rejects exactly as the real route would', () => {
  it('rejects an out-of-range component (> 1)', () => {
    const result = validateVote(validWeightPayload({ engagement_weight: 1.5 }), buildCtx());
    expect(result.valid).toBe(false);
  });

  it('rejects an out-of-range component (< 0)', () => {
    const result = validateVote(validWeightPayload({ recency_weight: -0.1 }), buildCtx());
    expect(result.valid).toBe(false);
  });

  it('rejects weights that do not sum to 1', () => {
    const result = validateVote(
      validWeightPayload({ recency_weight: 0.5, engagement_weight: 0.5 }),
      buildCtx()
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a weight vote whose raw sum is just beyond the 0.01 tolerance', () => {
    // 0.211 + 0.2*4 = 1.011 → |sum - 1| = 0.011, outside |sum - 1| < 0.01.
    // A hair past the edge (not exactly 0.01) so the assertion isn't
    // floating-point-fragile at the exclusive boundary.
    const result = validateVote(validWeightPayload({ recency_weight: 0.211 }), buildCtx());
    expect(result.valid).toBe(false);
  });

  it('rejects a partial weight vote (some but not all 5 components present)', () => {
    const result = validateVote(
      { voterDid: VOTER, recency_weight: 0.5, engagement_weight: 0.5 },
      buildCtx()
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an unregistered weight key (PROJ-816 guard)', () => {
    const result = validateVote({ ...validWeightPayload(), civility_weight: 0.5 }, buildCtx());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /unregistered/i.test(e))).toBe(true);
    }
  });

  it('rejects a non-subscriber voter', () => {
    const result = validateVote(
      { voterDid: 'did:plc:not-a-subscriber', include_keywords: ['news'] },
      buildCtx()
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /not an active subscriber/i.test(e))).toBe(true);
    }
  });

  it('rejects an invalid (inactive/nonexistent) topic slug', () => {
    const result = validateVote(
      { voterDid: VOTER, topic_weights: { 'totally-made-up-topic': 0.5 } },
      buildCtx()
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /invalid topic slug/i.test(e))).toBe(true);
    }
  });

  it('rejects an out-of-range topic weight', () => {
    const result = validateVote({ voterDid: VOTER, topic_weights: { sports: 1.5 } }, buildCtx());
    expect(result.valid).toBe(false);
  });

  it('rejects when the epoch phase is not "voting"', () => {
    const result = validateVote(validWeightPayload(), buildCtx({ epochPhase: 'running' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /voting is currently closed/i.test(e))).toBe(true);
    }
  });

  it('rejects a keyword longer than 50 characters', () => {
    const result = validateVote(
      { voterDid: VOTER, include_keywords: ['a'.repeat(51)] },
      buildCtx()
    );
    expect(result.valid).toBe(false);
  });

  it('rejects more than 20 include keywords', () => {
    const result = validateVote(
      { voterDid: VOTER, include_keywords: Array.from({ length: 21 }, (_, i) => `kw${i}`) },
      buildCtx()
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an empty vote (no weights, no keywords, no topic weights)', () => {
    const result = validateVote({ voterDid: VOTER }, buildCtx());
    expect(result.valid).toBe(false);
  });
});

describe('validateVote: keyword normalization mirrors the real route', () => {
  it('lowercases, trims, and dedupes keywords via the real normalizeKeywords helper', () => {
    const result = validateVote(
      { voterDid: VOTER, include_keywords: ['  Tech  ', 'tech', 'TECH'] },
      buildCtx()
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.includeKeywords).toEqual(['tech']);
    }
  });
});

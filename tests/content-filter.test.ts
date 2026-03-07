import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}));

import { getCurrentContentRules, checkContentRules } from '../src/governance/content-filter.js';

describe('content filter cache fallback', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    redisGetMock.mockReset();
    redisSetMock.mockReset();
    redisDelMock.mockReset();
  });

  it('returns cached rules on cache hit', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: ['ai'],
        excludeKeywords: ['spam'],
      })
    );

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['ai'],
      excludeKeywords: ['spam'],
    });
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('falls back to database when Redis read fails', async () => {
    redisGetMock.mockRejectedValue(new Error('redis unavailable'));
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          content_rules: {
            include_keywords: ['science'],
            exclude_keywords: ['ads'],
          },
        },
      ],
    });
    redisSetMock.mockResolvedValue('OK');

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['science'],
      excludeKeywords: ['ads'],
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty rules when Redis read fails and database query fails', async () => {
    redisGetMock.mockRejectedValue(new Error('redis unavailable'));
    dbQueryMock.mockRejectedValue(new Error('db unavailable'));

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: [],
      excludeKeywords: [],
    });
  });

  it('still returns database rules when cache write fails', async () => {
    redisGetMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          content_rules: {
            include_keywords: ['governance'],
            exclude_keywords: ['politics'],
          },
        },
      ],
    });
    redisSetMock.mockRejectedValue(new Error('redis write failed'));

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['governance'],
      excludeKeywords: ['politics'],
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });
});

describe('exclude keyword prefix matching', () => {
  const rulesWithExclude = (keyword: string) => ({
    includeKeywords: [] as string[],
    excludeKeywords: [keyword],
  });

  const rulesWithInclude = (keyword: string) => ({
    includeKeywords: [keyword],
    excludeKeywords: [] as string[],
  });

  it('exclude "kink" matches "kinks" (prefix)', () => {
    const result = checkContentRules('exploring kinks and preferences', rulesWithExclude('kink'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('kink');
  });

  it('exclude "kink" matches "kinky" (prefix)', () => {
    const result = checkContentRules('feeling kinky tonight', rulesWithExclude('kink'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('kink');
  });

  it('exclude "porn" matches "pornographic" (prefix)', () => {
    const result = checkContentRules('pornographic content detected', rulesWithExclude('porn'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('porn');
  });

  it('exclude "porn" matches "pornography" (prefix)', () => {
    const result = checkContentRules('against pornography online', rulesWithExclude('porn'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('porn');
  });

  it('exclude "nude" matches "nudes" (prefix)', () => {
    const result = checkContentRules('posting nudes online', rulesWithExclude('nude'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('nude');
  });

  it('exclude "nude" does NOT match "nudity" (different stem)', () => {
    // "nudity" is n-u-d-i-t-y, not n-u-d-e-*. Not a prefix match.
    // Both are in the seed keyword list as separate entries.
    const result = checkContentRules('no nudity allowed', rulesWithExclude('nude'));
    expect(result.passes).toBe(true);
  });

  it('exclude "erotic" matches "erotica" (prefix)', () => {
    const result = checkContentRules('writing erotica is fun', rulesWithExclude('erotic'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('erotic');
  });

  it('include "kink" does NOT match "kinks" (strict)', () => {
    const result = checkContentRules('exploring kinks and preferences', rulesWithInclude('kink'));
    expect(result.passes).toBe(false);
    expect(result.reason).toBe('no_include_match');
  });

  it('include "kink" matches exact "kink" (strict)', () => {
    const result = checkContentRules('this is a kink discussion', rulesWithInclude('kink'));
    expect(result.passes).toBe(true);
    expect(result.matchedKeyword).toBe('kink');
  });

  it('exclude still matches exact keyword', () => {
    const result = checkContentRules('this post is about porn', rulesWithExclude('porn'));
    expect(result.passes).toBe(false);
    expect(result.matchedKeyword).toBe('porn');
  });

  it('exclude does not match mid-word (leading boundary intact)', () => {
    // "unicorn" should NOT match exclude "corn" because "c" in unicorn is preceded by a letter
    const result = checkContentRules('i love unicorn stickers', rulesWithExclude('corn'));
    expect(result.passes).toBe(true);
  });

  it('prefix and strict matchers cache separately', () => {
    // Same keyword "kink" should produce different results for exclude vs include on "kinks"
    const excludeResult = checkContentRules('my kinks are private', rulesWithExclude('kink'));
    const includeResult = checkContentRules('my kinks are private', rulesWithInclude('kink'));

    expect(excludeResult.passes).toBe(false); // prefix: matches "kinks"
    expect(includeResult.passes).toBe(false); // strict: "kinks" ≠ "kink", no_include_match
    expect(includeResult.reason).toBe('no_include_match');
  });
});

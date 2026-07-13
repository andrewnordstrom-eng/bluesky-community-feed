import { describe, expect, it } from 'vitest';
import { checkContentRules } from '../src/governance/content-rule-matcher.js';

describe('content filter keyword matching', () => {
  it('does not match partial words for ASCII keywords', () => {
    const result = checkContentRules('jon bon jovi is such a fossil', {
      includeKeywords: ['foss'],
      excludeKeywords: [],
    });

    expect(result).toEqual({ passes: false, reason: 'no_include_match' });
  });

  it('matches whole words and hashtags for ASCII keywords', () => {
    const wordMatch = checkContentRules('love building foss tooling', {
      includeKeywords: ['foss'],
      excludeKeywords: [],
    });
    const hashtagMatch = checkContentRules('shipping updates for #foss projects', {
      includeKeywords: ['foss'],
      excludeKeywords: [],
    });

    expect(wordMatch).toEqual({ passes: true, matchedKeyword: 'foss' });
    expect(hashtagMatch).toEqual({ passes: true, matchedKeyword: 'foss' });
  });

  it('supports phrase matching across spaces and hyphens', () => {
    const spaced = checkContentRules('new feed generator docs are live', {
      includeKeywords: ['feed generator'],
      excludeKeywords: [],
    });
    const hyphenated = checkContentRules('new feed-generator docs are live', {
      includeKeywords: ['feed generator'],
      excludeKeywords: [],
    });

    expect(spaced).toEqual({ passes: true, matchedKeyword: 'feed generator' });
    expect(hyphenated).toEqual({ passes: true, matchedKeyword: 'feed generator' });
  });

  it('keeps fallback substring behavior for symbol keywords', () => {
    const result = checkContentRules('this room is 18+ only', {
      includeKeywords: [],
      excludeKeywords: ['18+'],
    });

    expect(result).toEqual({
      passes: false,
      reason: 'excluded_keyword',
      matchedKeyword: '18+',
    });
  });

  it('prevents include matches inside larger words', () => {
    const result = checkContentRules('counterprogramming is all over sports tv', {
      includeKeywords: ['programming'],
      excludeKeywords: [],
    });

    expect(result).toEqual({ passes: false, reason: 'no_include_match' });
  });

  it('does not treat accented letters as boundaries for ASCII keywords', () => {
    const result = checkContentRules('Le Fosse Mortel est different de Fossé', {
      includeKeywords: ['foss'],
      excludeKeywords: [],
    });

    expect(result).toEqual({ passes: false, reason: 'no_include_match' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  isStrictOpenScienceCandidate,
  openScienceInclusionReasons,
} from '../src/demo/corpus.js';

describe('strict Open Science shadow corpus selection', () => {
  it('requires both a canonical topic score at or above 0.5 and a matching text term', () => {
    expect(isStrictOpenScienceCandidate(
      'Released the replication dataset and analysis notebook.',
      { 'science-research': 0.81 }
    )).toBe(true);
    expect(isStrictOpenScienceCandidate(
      'Please help this dog fundraiser reach its goal.',
      { 'science-research': 0.93 }
    )).toBe(false);
    expect(isStrictOpenScienceCandidate(
      'Released the replication dataset and analysis notebook.',
      { 'science-research': 0.49 }
    )).toBe(false);
    expect(isStrictOpenScienceCandidate(
      'Released the replication dataset and analysis notebook.',
      { 'science-research': 0.5 }
    )).toBe(true);
    expect(isStrictOpenScienceCandidate(
      'Released the replication dataset and analysis notebook.',
      { 'science-research': Number.NaN }
    )).toBe(false);
    expect(isStrictOpenScienceCandidate(
      'Released the replication dataset and analysis notebook.',
      { politics: 0.99 }
    )).toBe(false);
  });

  it('returns inspectable per-post inclusion reasons', () => {
    const reasons = openScienceInclusionReasons(
      'Open-source Python code and CSV data for a reproducibility study.',
      {
        'science-research': 0.74,
        'software-development': 0.82,
        'open-source': 0.91,
        politics: 0.95,
      }
    );

    expect(reasons.matchedTopics.map((topic) => topic.topic)).toEqual([
      'open-source',
      'software-development',
      'science-research',
    ]);
    expect(reasons.matchedTerms).toEqual(expect.arrayContaining([
      'open source',
      'Python',
      'code',
      'CSV',
      'reproducibility',
      'study',
    ]));

    expect(openScienceInclusionReasons('', {})).toEqual({
      matchedTopics: [],
      matchedTerms: [],
    });
    expect(openScienceInclusionReasons('Research dataset', {
      'science-research': 0,
      'data-science': 1,
      'open-source': Number.NaN,
    })).toMatchObject({
      matchedTopics: [{ topic: 'data-science', score: 1 }],
      matchedTerms: expect.arrayContaining(['research', 'dataset']),
    });
  });
});

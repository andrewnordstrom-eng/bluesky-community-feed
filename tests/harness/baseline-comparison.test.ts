/**
 * Baseline-Comparison Unit Tests (PROJ-1486 / A5)
 *
 * Pure — no Postgres/Redis/Testcontainers dependency. Covers the
 * `assertLongtableWriteConfig` precondition guard directly, so the READ-on /
 * DUALWRITE-off misconfiguration (which would otherwise make the governed
 * regime's `aggregateVotes` silently read an empty long table) is pinned
 * without standing up the whole pipeline.
 */

import { describe, expect, it } from 'vitest';
import {
  assertLongtableWriteConfig,
  buildBaselineComparisonArtifactRows,
  type BaselineComparisonResult,
} from '../../src/harness/baseline-comparison.js';

const EQUAL_WEIGHTS = {
  recency: 0.2,
  engagement: 0.2,
  bridging: 0.2,
  sourceDiversity: 0.2,
  relevance: 0.2,
};

describe('assertLongtableWriteConfig', () => {
  it('throws, naming DUALWRITE, when READ is on but DUALWRITE is off', () => {
    expect(() =>
      assertLongtableWriteConfig({
        GOVERNANCE_LONGTABLE_READ_ENABLED: true,
        GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED: false,
      })
    ).toThrow(/GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED/);
  });

  it('does not throw when both are on (the production default)', () => {
    expect(() =>
      assertLongtableWriteConfig({
        GOVERNANCE_LONGTABLE_READ_ENABLED: true,
        GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED: true,
      })
    ).not.toThrow();
  });

  it('does not throw when READ is off (the long table is not the read source)', () => {
    expect(() =>
      assertLongtableWriteConfig({
        GOVERNANCE_LONGTABLE_READ_ENABLED: false,
        GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED: false,
      })
    ).not.toThrow();
  });
});

describe('buildBaselineComparisonArtifactRows', () => {
  it('renders zero-overlap regime pairs as nullable rank metrics instead of throwing', () => {
    const result: BaselineComparisonResult = {
      population: {} as BaselineComparisonResult['population'],
      corpusTopicSupport: { news: 1 },
      corpusPostInfo: [
        { uri: 'at://post/no-governance', authorDid: 'did:example:no-governance', topicVector: { news: 1 } },
        { uri: 'at://post/engagement-only', authorDid: 'did:example:engagement-only', topicVector: { news: 1 } },
        { uri: 'at://post/community-governed', authorDid: 'did:example:community-governed', topicVector: { news: 1 } },
      ],
      regimes: {
        'no-governance': {
          regime: 'no-governance',
          epochId: 1,
          weights: EQUAL_WEIGHTS,
          feed: [{ uri: 'at://post/no-governance', rank: 1 }],
          scoreByUri: new Map([['at://post/no-governance', 1]]),
        },
        'engagement-only': {
          regime: 'engagement-only',
          epochId: 2,
          weights: { ...EQUAL_WEIGHTS, engagement: 1, recency: 0, bridging: 0, sourceDiversity: 0, relevance: 0 },
          feed: [{ uri: 'at://post/engagement-only', rank: 1 }],
          scoreByUri: new Map([['at://post/engagement-only', 1]]),
        },
        'community-governed': {
          regime: 'community-governed',
          epochId: 3,
          weights: EQUAL_WEIGHTS,
          feed: [{ uri: 'at://post/community-governed', rank: 1 }],
          scoreByUri: new Map([['at://post/community-governed', 1]]),
        },
      },
    };

    const rows = buildBaselineComparisonArtifactRows(result, 0.15).pairwiseRows;

    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regimeA: 'no-governance',
          regimeB: 'engagement-only',
          sharedCount: 0,
          rankDisplacement: null,
          kendallTau: null,
        }),
      ])
    );
    expect(rows.every((row) => row.rankDisplacement === null && row.kendallTau === null)).toBe(true);
  });

  it('renders empty regime feeds with nullable author concentration metrics', () => {
    const result: BaselineComparisonResult = {
      population: {} as BaselineComparisonResult['population'],
      corpusTopicSupport: {},
      corpusPostInfo: [],
      regimes: {
        'no-governance': {
          regime: 'no-governance',
          epochId: 1,
          weights: EQUAL_WEIGHTS,
          feed: [],
          scoreByUri: new Map(),
        },
        'engagement-only': {
          regime: 'engagement-only',
          epochId: 2,
          weights: { ...EQUAL_WEIGHTS, engagement: 1, recency: 0, bridging: 0, sourceDiversity: 0, relevance: 0 },
          feed: [],
          scoreByUri: new Map(),
        },
        'community-governed': {
          regime: 'community-governed',
          epochId: 3,
          weights: EQUAL_WEIGHTS,
          feed: [],
          scoreByUri: new Map(),
        },
      },
    };

    const { summaryRows, pairwiseRows } = buildBaselineComparisonArtifactRows(result, 0.15);

    expect(summaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regime: 'community-governed',
          authorHHI: null,
          authorGini: null,
          minorityTopicExposure: 0,
        }),
      ])
    );
    expect(pairwiseRows.every((row) => row.sharedCount === 0 && row.rankDisplacement === null)).toBe(true);
  });
});

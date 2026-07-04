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
import { assertLongtableWriteConfig } from '../../src/harness/baseline-comparison.js';

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

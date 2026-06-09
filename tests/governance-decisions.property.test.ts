/**
 * Property + unit tests for the pure governance decision logic (quorum).
 *
 * These pin the quorum *policy* (the thing PROJ-1045 is about — the policy is
 * correct; the bug was that an apply path bypassed it). Routing every quorum
 * check through `quorumMet` makes that class of drift impossible.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { quorumMet, quorumStatus } from '../src/governance/governance-decisions.js';

describe('quorumMet', () => {
  it('is met exactly at and above the minimum (boundary)', () => {
    expect(quorumMet(4, 5)).toBe(false);
    expect(quorumMet(5, 5)).toBe(true);
    expect(quorumMet(6, 5)).toBe(true);
  });

  it('is monotonic non-decreasing in vote count', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000 }),
        fc.nat({ max: 10_000 }),
        fc.nat({ max: 10_000 }),
        (a, b, minVotes) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          // more votes can never lose a quorum you already had
          if (quorumMet(lo, minVotes)) expect(quorumMet(hi, minVotes)).toBe(true);
        }
      )
    );
  });

  it('agrees with the boolean threshold for all inputs', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), fc.nat({ max: 10_000 }), (votes, minVotes) => {
        expect(quorumMet(votes, minVotes)).toBe(votes >= minVotes);
      })
    );
  });
});

describe('quorumStatus', () => {
  it('reports met === quorumMet and a non-negative shortfall', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), fc.nat({ max: 10_000 }), (votes, minVotes) => {
        const s = quorumStatus(votes, minVotes);
        expect(s.met).toBe(quorumMet(votes, minVotes));
        expect(s.shortfall).toBeGreaterThanOrEqual(0);
        expect(s.shortfall).toBe(s.met ? 0 : minVotes - votes);
        // shortfall is exactly the additional votes needed to flip to met
        if (!s.met) expect(quorumMet(votes + s.shortfall, minVotes)).toBe(true);
      })
    );
  });
});

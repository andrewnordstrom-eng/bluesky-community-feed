/**
 * Governance mechanism simulation (Layer 3).
 *
 * Runs deterministic synthetic electorates + Sybil attacks through the real
 * aggregation core to quantify how robust the voting rule is at scale. This is the
 * reproducible evidence behind PROJ-1048 (Sybil: N DIDs => N votes): the trimmed
 * mean absorbs a small flood but not one larger than its ~10% trim.
 */
import { describe, expect, it } from 'vitest';
import type { GovernanceWeights } from '../src/governance/governance.types.js';
import {
  mulberry32,
  generatePopulation,
  sybilSockpuppets,
  extremeBallot,
  runScenario,
  l1Shift,
} from './governance-sim/harness.js';

const SEED = 0xc0ffee;
const CENTER = [0.25, 0.2, 0.2, 0.15, 0.2] as const; // honest electorate leans recency
const honest = () => generatePopulation(100, mulberry32(SEED), 'clustered', CENTER);

const attacker = extremeBallot('relevance_weight'); // attacker wants relevance to dominate

const baseline = runScenario('honest-100', honest());
const smallSybil = runScenario('+5 sybil', [...honest(), ...sybilSockpuppets(attacker, 5)]);
const largeSybil = runScenario('+40 sybil', [...honest(), ...sybilSockpuppets(attacker, 40)]);

const fmt = (w: GovernanceWeights): string =>
  (Object.entries(w) as [string, number][]).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' ');

describe('governance simulation — reproducibility', () => {
  it('is deterministic for a fixed seed', () => {
    expect(runScenario('rerun', honest()).weights).toEqual(baseline.weights);
  });
});

describe('governance simulation — Sybil resistance (PROJ-1048)', () => {
  it('absorbs a small Sybil flood (within the ~10% trim)', () => {
    // 5 sockpuppets of 105 → trimCount = floor(105*0.1) = 10 ≥ 5 → trimmed away.
    expect(l1Shift(smallSybil.weights, baseline.weights)).toBeLessThan(0.05);
  });

  it('does NOT resist a Sybil flood larger than the trim window', () => {
    // 40 sockpuppets of 140 → trimCount = 14 < 40 → 26 survive and pull the result.
    const small = l1Shift(smallSybil.weights, baseline.weights);
    const large = l1Shift(largeSybil.weights, baseline.weights);
    expect(large).toBeGreaterThan(small * 2);
    expect(large).toBeGreaterThan(0.05);
  });

  it('prints the outcome shifts (informational)', () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '  GOVERNANCE SYBIL SIMULATION — 100 honest voters; attacker floods "relevance"',
        `  baseline    dom=${baseline.dominant.padEnd(10)} ${fmt(baseline.weights)}`,
        `  +5 sybil    dom=${smallSybil.dominant.padEnd(10)} ${fmt(smallSybil.weights)}  L1Δ=${l1Shift(smallSybil.weights, baseline.weights).toFixed(3)}`,
        `  +40 sybil   dom=${largeSybil.dominant.padEnd(10)} ${fmt(largeSybil.weights)}  L1Δ=${l1Shift(largeSybil.weights, baseline.weights).toFixed(3)}`,
        '',
      ].join('\n')
    );
    expect(baseline.voters).toBe(100);
  });
});

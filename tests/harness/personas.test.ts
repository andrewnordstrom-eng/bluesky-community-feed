/**
 * Persona Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency, same pattern as
 * population.test.ts / prod-guard.test.ts. `castPersonaVote`/`pickPersona`
 * are pure functions of an injected `Rng`, so they're fully exercisable here.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/harness/rng.js';
import {
  PERSONA_IDS,
  PERSONAS,
  DEFAULT_PERSONA_MIX,
  castPersonaVote,
  pickPersona,
} from '../../src/harness/personas.js';

const TOPIC_SLUGS = ['software-development', 'sports', 'music', 'science', 'politics'] as const;

function dominantComponent(weights: Record<string, number>): string {
  return Object.entries(weights).reduce((max, entry) => (entry[1] > max[1] ? entry : max))[0];
}

describe('castPersonaVote: determinism', () => {
  it('the same seed always produces byte-identical weights and topic weights', () => {
    const first = castPersonaVote(createRng(42), PERSONAS['engagement-maximizer'], TOPIC_SLUGS);
    const second = castPersonaVote(createRng(42), PERSONAS['engagement-maximizer'], TOPIC_SLUGS);

    expect(second.weights).toEqual(first.weights);
    expect(second.topicWeights).toEqual(first.topicWeights);
  });

  it('is deterministic across every registered persona, not just one', () => {
    for (const id of PERSONA_IDS) {
      const persona = PERSONAS[id];
      const first = castPersonaVote(createRng(7), persona, TOPIC_SLUGS);
      const second = castPersonaVote(createRng(7), persona, TOPIC_SLUGS);
      expect(second).toEqual(first);
    }
  });

  it('a different seed can produce a different draw (sanity check the RNG is actually wired in)', () => {
    const a = castPersonaVote(createRng(1), PERSONAS.balanced, TOPIC_SLUGS);
    const b = castPersonaVote(createRng(2), PERSONAS.balanced, TOPIC_SLUGS);
    expect(a).not.toEqual(b);
  });
});

describe('castPersonaVote: weight normalization', () => {
  it('every persona always emits weights that sum to exactly 1 (real normalizeWeights invariant)', () => {
    for (const id of PERSONA_IDS) {
      for (const seed of [1, 2, 3, 99, 12345]) {
        const { weights } = castPersonaVote(createRng(seed), PERSONAS[id], TOPIC_SLUGS);
        const sum = Object.values(weights).reduce((total, value) => total + value, 0);
        expect(sum).toBeCloseTo(1, 9);
        for (const value of Object.values(weights)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it.each([
    ['engagement-maximizer', 'engagement'],
    ['chronological-purist', 'recency'],
    ['bridge-builder', 'bridging'],
  ] as const)('%s always weights %s as its dominant component', (personaId, expectedDominant) => {
    for (const seed of [1, 2, 3, 4, 5, 100, 4242]) {
      const { weights } = castPersonaVote(createRng(seed), PERSONAS[personaId], TOPIC_SLUGS);
      expect(dominantComponent(weights)).toBe(expectedDominant);
    }
  });

  it('the balanced persona never lets one component run away with the vote', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { weights } = castPersonaVote(createRng(seed), PERSONAS.balanced, TOPIC_SLUGS);
      for (const value of Object.values(weights)) {
        // Base is 0.2 each with a small jitter — no component should dominate
        // the way a scripted persona's signature component does.
        expect(value).toBeGreaterThan(0.1);
        expect(value).toBeLessThan(0.3);
      }
    }
  });
});

describe('castPersonaVote: topic-weight affinity', () => {
  it('emits one weight per requested topic slug, every value within [0, 1]', () => {
    const { topicWeights } = castPersonaVote(createRng(5), PERSONAS['bridge-builder'], TOPIC_SLUGS);
    expect(Object.keys(topicWeights).sort()).toEqual([...TOPIC_SLUGS].sort());
    for (const value of Object.values(topicWeights)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('gives affinity topics a strictly higher weight range than non-affinity topics', () => {
    const persona = PERSONAS['bridge-builder']; // affinities: science, software-development
    for (const seed of [1, 2, 3, 4, 5, 6, 7]) {
      const { topicWeights } = castPersonaVote(createRng(seed), persona, TOPIC_SLUGS);
      for (const slug of persona.topicAffinities) {
        expect(topicWeights[slug]).toBeGreaterThanOrEqual(0.6);
      }
      for (const slug of TOPIC_SLUGS) {
        if (!persona.topicAffinities.includes(slug)) {
          expect(topicWeights[slug]).toBeLessThanOrEqual(0.35);
        }
      }
    }
  });

  it('a persona with no topic affinities (balanced) never favors any slug', () => {
    const { topicWeights } = castPersonaVote(createRng(9), PERSONAS.balanced, TOPIC_SLUGS);
    for (const value of Object.values(topicWeights)) {
      expect(value).toBeLessThanOrEqual(0.35);
    }
  });
});

describe('pickPersona', () => {
  it('is deterministic given a seed', () => {
    const first = pickPersona(createRng(11), DEFAULT_PERSONA_MIX);
    const second = pickPersona(createRng(11), DEFAULT_PERSONA_MIX);
    expect(second.id).toBe(first.id);
  });

  it('always returns the single persona with positive weight when every other weight is 0', () => {
    const mix = {
      'engagement-maximizer': 0,
      'chronological-purist': 0,
      'bridge-builder': 1,
      balanced: 0,
    };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(pickPersona(createRng(seed), mix).id).toBe('bridge-builder');
    }
  });

  it('throws if every persona weight is zero (nothing to draw from)', () => {
    const mix = {
      'engagement-maximizer': 0,
      'chronological-purist': 0,
      'bridge-builder': 0,
      balanced: 0,
    };
    expect(() => pickPersona(createRng(1), mix)).toThrow(/positive weight/);
  });

  it('draws every registered persona at least once across enough samples of the default (equal) mix', () => {
    const seen = new Set<string>();
    const rng = createRng(2024);
    for (let i = 0; i < 200; i++) {
      seen.add(pickPersona(rng, DEFAULT_PERSONA_MIX).id);
    }
    expect([...seen].sort()).toEqual([...PERSONA_IDS].sort());
  });
});

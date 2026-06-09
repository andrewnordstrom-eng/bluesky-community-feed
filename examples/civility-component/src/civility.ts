/**
 * Example external scoring component — civility.
 *
 * Imports ONLY from @corgi/feed-sdk. If this file fails to type-check
 * against the SDK exports alone, the public contract has a leak and
 * PROJ-818's plug-in claim is incomplete. The CI workflow at
 * .github/workflows/examples-build.yml exercises this build on every PR.
 *
 * A real civility classifier would call out to a model. This stub returns
 * 0.5 — a neutral midpoint. The point here is the shape, not the algorithm.
 */

import {
  createComponent,
  type PostForScoring,
  type ScoringComponent,
  type ScoringContext,
} from '@corgi/feed-sdk';

/**
 * Simple lexicon-based proxy for civility. Real components would swap in
 * a classifier; this exists to make the example testable without any
 * external dependency.
 */
const HOSTILE_TOKENS = new Set([
  'idiot',
  'moron',
  'stupid',
  'hate',
  'shut up',
  'kill yourself',
]);

/**
 * Score a post's civility on a 0..1 scale.
 *   1.0 = no hostile tokens detected.
 *   0.0 = every word is a hostile token.
 * Linear penalty in between.
 *
 * Posts with no text get a neutral 0.5.
 */
function scoreCivility(text: string | null): number {
  if (!text || text.trim().length === 0) {
    return 0.5;
  }
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return 0.5;
  }
  let hostile = 0;
  for (const w of words) {
    if (HOSTILE_TOKENS.has(w)) {
      hostile++;
    }
  }
  // Also catch multi-token phrases.
  for (const phrase of HOSTILE_TOKENS) {
    if (phrase.includes(' ') && lower.includes(phrase)) {
      hostile++;
    }
  }
  const penaltyRatio = Math.min(hostile / words.length, 1);
  return Math.max(0, 1 - penaltyRatio);
}

/**
 * The component itself — wires the scoring function into the SDK contract.
 *
 * To register this in production, an operator would:
 *   1. Add `import { civilityComponent } from '@corgi-example/civility-component'`
 *      to src/scoring/registry.ts.
 *   2. Append `civilityComponent` to DEFAULT_COMPONENTS.
 *   3. Add a matching entry to src/config/votable-params.ts (the registry
 *      drift check at module load enforces this pairing).
 *   4. Optionally seed an initial weight in governance_epoch_weights for
 *      the current epoch (post-PROJ-819; pre-cutover this needs the
 *      ALTER TABLE described in scripts/generate-scoring-component.ts).
 */
export const civilityComponent: ScoringComponent = createComponent({
  key: 'civility',
  name: 'Civility',
  async score(post: PostForScoring, _context: ScoringContext): Promise<number> {
    return scoreCivility(post.text);
  },
});

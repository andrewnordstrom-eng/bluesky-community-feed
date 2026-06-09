/**
 * Example external scoring component.
 *
 * This file exists to prove the @corgi/feed-sdk public surface is
 * self-contained — an external contributor can implement a ScoringComponent
 * using only the SDK exports, with zero imports from `src/` or any other
 * internal path.
 *
 * If this file fails to type-check, the SDK has a missing or leaky export
 * and PROJ-818's plug-in claim is incomplete. CI (added in PROJ-820 / P7)
 * exercises this fixture on every PR.
 *
 * Component authors writing a real component would put their file under
 * their own repo and import the same way; this fixture lives in `tests/` so
 * the production registry never picks it up.
 */

import {
  createComponent,
  voteFieldForKey,
  type PostForScoring,
  type ScoringComponent,
  type ScoringContext,
  type GovernanceWeights,
  type WeightedScore,
} from '@corgi/feed-sdk';

/**
 * Stub "civility" component — returns a fixed 0.5 for every post. A real
 * implementation would call out to a classifier; the point here is the type
 * contract, not the algorithm.
 */
export const civilityComponent: ScoringComponent = createComponent({
  key: 'civility',
  name: 'Civility (example external component)',
  async score(_post: PostForScoring, _context: ScoringContext): Promise<number> {
    return 0.5;
  },
});

/**
 * Smoke check that the helper preserves contract semantics — score must be
 * 0..1, key must round-trip through voteFieldForKey for the wide-column
 * window (transitional helper, removed after PROJ-819).
 */
export async function smokeCheck(): Promise<void> {
  const post: PostForScoring = {
    uri: 'at://did:plc:example/app.bsky.feed.post/abc',
    cid: 'bafyreigexample',
    authorDid: 'did:plc:example',
    text: 'hello world',
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date(),
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
  };

  const weights: GovernanceWeights = { civility: 1.0 };

  const context: ScoringContext = {
    epoch: {
      id: 0,
      status: 'active',
      weights,
      voteCount: 0,
      createdAt: new Date(),
      closedAt: null,
      description: null,
    },
    scoringWindowHours: 72,
    authorCounts: new Map(),
  };

  const raw = await civilityComponent.score(post, context);
  if (raw < 0 || raw > 1) {
    throw new Error(`civility component returned out-of-range value: ${raw}`);
  }

  const decomposed: WeightedScore = {
    raw: { civility: raw },
    weights: { civility: weights.civility ?? 0 },
    weighted: { civility: raw * (weights.civility ?? 0) },
    total: raw * (weights.civility ?? 0),
  };

  if (voteFieldForKey('civility') !== 'civility_weight') {
    throw new Error(
      `voteFieldForKey('civility') = ${voteFieldForKey('civility')}, expected 'civility_weight'`
    );
  }

  if (voteFieldForKey('sourceDiversity') !== 'source_diversity_weight') {
    throw new Error(
      `voteFieldForKey('sourceDiversity') = ${voteFieldForKey('sourceDiversity')}, expected 'source_diversity_weight'`
    );
  }

  if (decomposed.total !== raw) {
    throw new Error(
      `decomposed.total = ${decomposed.total}, expected ${raw} (single-component perfect alignment)`
    );
  }
}

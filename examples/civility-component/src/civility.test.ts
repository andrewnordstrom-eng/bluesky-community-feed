/**
 * Hermetic test for the example civility component.
 *
 * Uses node:test (no vitest dependency in the example) so an external
 * contributor can run this with just node + tsx, no monorepo setup. The
 * test runner is wired in package.json's "test" script.
 *
 * If you're reading this as a template for your own component, this file
 * is the minimum: import the component, hand-build a PostForScoring + a
 * ScoringContext, assert the score returned is in 0..1.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import type { PostForScoring, ScoringContext } from '@corgi/feed-sdk';

import { civilityComponent } from './civility.js';

function makePost(text: string | null): PostForScoring {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/abc',
    cid: 'bafyreigtest',
    authorDid: 'did:plc:test',
    text,
    replyRoot: null,
    replyParent: null,
    langs: ['en'],
    hasMedia: false,
    createdAt: new Date(),
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
  };
}

const ctx: ScoringContext = {
  epoch: {
    id: 1,
    status: 'active',
    weights: { civility: 1.0 },
    voteCount: 0,
    createdAt: new Date(),
    closedAt: null,
    description: null,
  },
  scoringWindowHours: 72,
  authorCounts: new Map(),
};

test('civilityComponent has the right contract shape', () => {
  assert.equal(civilityComponent.key, 'civility');
  assert.equal(civilityComponent.name, 'Civility');
  assert.equal(typeof civilityComponent.score, 'function');
});

test('returns the neutral midpoint for empty/null text', async () => {
  assert.equal(await civilityComponent.score(makePost(null), ctx), 0.5);
  assert.equal(await civilityComponent.score(makePost(''), ctx), 0.5);
  assert.equal(await civilityComponent.score(makePost('   '), ctx), 0.5);
});

test('returns 1.0 for civil text with no hostile tokens', async () => {
  const score = await civilityComponent.score(
    makePost('a thoughtful post about feed governance'),
    ctx
  );
  assert.equal(score, 1.0);
});

test('penalizes hostile single-word tokens', async () => {
  const score = await civilityComponent.score(
    makePost('you are an idiot'),
    ctx
  );
  // 1 hostile out of 4 words = penalty 0.25 → score 0.75.
  assert.ok(score < 1.0, `expected < 1.0 from hostile word, got ${score}`);
  assert.ok(score >= 0.5, `expected >= 0.5, got ${score}`);
});

test('penalizes hostile multi-token phrases', async () => {
  const score = await civilityComponent.score(
    makePost('this post says kill yourself which is awful'),
    ctx
  );
  assert.ok(score < 1.0, `expected < 1.0 from hostile phrase, got ${score}`);
});

test('always returns a value in [0, 1]', async () => {
  const cases = [
    null,
    '',
    'civil text',
    'idiot moron stupid hate',
    'a normal post',
    'thoughtful reasoning',
  ];
  for (const text of cases) {
    const score = await civilityComponent.score(makePost(text), ctx);
    assert.ok(score >= 0 && score <= 1, `out of range for "${text}": ${score}`);
  }
});

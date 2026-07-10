import { describe, expect, it } from 'vitest';
import { buildAppViewGetPostsUrl, hydrateCorpusItemsWithAppView } from '../src/demo/appview.js';
import {
  bskyPostUrlFromAtUri,
  hiddenReasonForPublicView,
  publicPostFromAppView,
  type AppViewPost,
} from '../src/demo/public-view.js';

const PUBLIC_POST: AppViewPost = {
  uri: 'at://did:plc:author/app.bsky.feed.post/abc123',
  cid: 'bafyabc123',
  author: {
    did: 'did:plc:author',
    handle: 'maya-keene.bsky.social',
    displayName: 'Maya Keene',
    avatar: 'https://cdn.example/avatar.jpg',
  },
  record: {
    text: 'A public birding post',
    createdAt: '2026-07-09T12:00:00.000Z',
  },
  indexedAt: '2026-07-09T12:00:01.000Z',
  likeCount: 3,
  repostCount: 2,
  replyCount: 1,
  quoteCount: 0,
  labels: [],
};

describe('shadow demo public-view filtering', () => {
  it('builds official AppView getPosts URLs with repeated uri params', () => {
    const url = new URL(
      buildAppViewGetPostsUrl([
        'at://did:plc:one/app.bsky.feed.post/a',
        'at://did:plc:two/app.bsky.feed.post/b',
      ])
    );

    expect(url.origin).toBe('https://public.api.bsky.app');
    expect(url.pathname).toBe('/xrpc/app.bsky.feed.getPosts');
    expect(url.searchParams.getAll('uris')).toEqual([
      'at://did:plc:one/app.bsky.feed.post/a',
      'at://did:plc:two/app.bsky.feed.post/b',
    ]);
  });

  it('renders public AppView records as Bluesky display posts', () => {
    expect(publicPostFromAppView(PUBLIC_POST)).toMatchObject({
      kind: 'public_post',
      uri: PUBLIC_POST.uri,
      authorHandle: 'maya-keene.bsky.social',
      text: 'A public birding post',
      likeCount: 3,
    });
  });

  it('hides no-unauthenticated, hide, and adult-only labeled records', () => {
    expect(
      hiddenReasonForPublicView({
        ...PUBLIC_POST,
        labels: [{ val: '!no-unauthenticated' }],
      })
    ).toContain('!no-unauthenticated');
    expect(
      hiddenReasonForPublicView({
        ...PUBLIC_POST,
        labels: [{ val: '!hide' }],
      })
    ).toContain('!hide');
    expect(
      hiddenReasonForPublicView({
        ...PUBLIC_POST,
        labels: [{ val: 'porn' }],
      })
    ).toContain('porn');
  });

  it('hidden rows do not expose text, handle, avatar, or URL fields', () => {
    const display = publicPostFromAppView({
      ...PUBLIC_POST,
      labels: [{ val: '!hide' }],
    });

    expect(display).toEqual({
      kind: 'hidden_post',
      reason: 'Hidden by Bluesky public-view label !hide',
    });
    expect(JSON.stringify(display)).not.toContain('maya-keene');
    expect(JSON.stringify(display)).not.toContain('A public birding post');
    expect(JSON.stringify(display)).not.toContain('avatar');
    expect(JSON.stringify(display)).not.toContain('bsky.app');
  });

  it('builds Bluesky source URLs from AT Protocol post URIs', () => {
    expect(bskyPostUrlFromAtUri('at://did:plc:author/app.bsky.feed.post/abc123')).toBe(
      'https://bsky.app/profile/did%3Aplc%3Aauthor/post/abc123'
    );
  });

  it('rejects reserved or control characters in Bluesky post AT-URIs', () => {
    for (const uri of [
      'at://did:plc:author/app.bsky.feed.post/abc?next=1',
      'at://did:plc:author/app.bsky.feed.post/abc#fragment',
      'at://did:plc:author/app.bsky.feed.post/abc 123',
    ]) {
      expect(() => bskyPostUrlFromAtUri(uri)).toThrow(/non-post AT-URI/);
    }
  });

  it('fails closed for malformed post and author label arrays', () => {
    for (const malformed of [
      { ...PUBLIC_POST, labels: 'not-an-array' },
      { ...PUBLIC_POST, author: { ...PUBLIC_POST.author, labels: 'not-an-array' } },
    ]) {
      expect(publicPostFromAppView(malformed)).toEqual({
        kind: 'hidden_post',
        reason: 'Post metadata unavailable from Bluesky public AppView',
      });
    }
  });

  it('normalizes invalid engagement counters to zero', () => {
    const display = publicPostFromAppView({
      ...PUBLIC_POST,
      likeCount: -1,
      repostCount: 1.5,
      replyCount: Number.NaN,
      quoteCount: Number.POSITIVE_INFINITY,
    });

    expect(display).toMatchObject({
      kind: 'public_post',
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    });
  });

  it('turns missing public metadata into an identity-free hidden row', () => {
    for (const malformed of [
      { ...PUBLIC_POST, cid: undefined },
      { ...PUBLIC_POST, indexedAt: undefined },
      { ...PUBLIC_POST, author: { ...PUBLIC_POST.author, did: undefined } },
      { ...PUBLIC_POST, author: { ...PUBLIC_POST.author, handle: '   ' } },
      { ...PUBLIC_POST, record: { ...PUBLIC_POST.record, createdAt: undefined } },
      { ...PUBLIC_POST, record: { ...PUBLIC_POST.record, text: '   ' } },
    ]) {
      const display = publicPostFromAppView(malformed);
      expect(display.kind).toBe('hidden_post');
      expect(JSON.stringify(display)).not.toContain('maya-keene');
      expect(JSON.stringify(display)).not.toContain('A public birding post');
    }
  });

  it('isolates malformed AppView posts while hydrating valid neighbors', async () => {
    const items = [
      corpusItem('at://did:plc:author/app.bsky.feed.post/abc123'),
      corpusItem('at://did:plc:other/app.bsky.feed.post/broken'),
    ];
    const hydrated = await hydrateCorpusItemsWithAppView({
      items,
      timeoutMs: 1_000,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          posts: [
            PUBLIC_POST,
            {
              ...PUBLIC_POST,
              uri: 'at://did:plc:other/app.bsky.feed.post/broken',
              cid: 42,
            },
          ],
        }),
      }),
    });

    expect(hydrated[0].displayPost.kind).toBe('public_post');
    expect(hydrated[1].displayPost).toEqual({
      kind: 'hidden_post',
      reason: 'Post unavailable from Bluesky public AppView',
    });
  });

  it('withholds a failed AppView batch while preserving successful batches', async () => {
    const items = Array.from({ length: 26 }, (_, index) =>
      corpusItem(`at://did:plc:author/app.bsky.feed.post/post-${index}`)
    );
    let requestCount = 0;

    const hydrated = await hydrateCorpusItemsWithAppView({
      items,
      timeoutMs: 1_000,
      fetchFn: async (input) => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: false,
            status: 503,
            text: async () => 'temporarily unavailable',
          };
        }
        const uri = new URL(input).searchParams.get('uris');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            posts: [{ ...PUBLIC_POST, uri }],
          }),
        };
      },
    });

    expect(requestCount).toBe(2);
    expect(hydrated.slice(0, 25).every((item) => item.displayPost.kind === 'hidden_post')).toBe(true);
    expect(hydrated[25].displayPost.kind).toBe('public_post');
  });
});

function corpusItem(postUri: string) {
  return {
    postUri,
    authorDid: null,
    createdAt: '2026-07-09T12:00:00.000Z',
    topicVector: { 'science-research': 0.8 },
    rawScores: {
      recency: 0.5,
      engagement: 0.5,
      bridging: 0.5,
      source_diversity: 0.5,
      relevance: 0.5,
    },
    productionScore: 0.5,
    productionEpochId: 2,
    scoredAt: '2026-07-09T12:00:00.000Z',
    componentDetails: null,
    displayPost: { kind: 'hidden_post' as const, reason: 'Not hydrated' },
  };
}

import { describe, expect, it } from 'vitest';
import {
  bskyPostUrlFromAtUri,
  buildPostHydrationUrl,
  scoreComponentsFromExplanation,
  topicBreakdownFromExplanation,
  LiveDemoDataError,
} from '../web-next/lib/live-demo-data';

type ExplanationFixture = Parameters<typeof scoreComponentsFromExplanation>[0];

const EXPLANATION_FIXTURE = {
  post_uri: 'at://did:plc:example123/app.bsky.feed.post/3abc',
  epoch_id: 2,
  total_score: 0.83,
  rank: 1,
  components: {
    recency: { raw_score: 0.8, weight: 0.25, weighted: 0.2 },
    engagement: { raw_score: 0.7, weight: 0.2, weighted: 0.14 },
    bridging: { raw_score: 0.6, weight: 0.1, weighted: 0.06 },
    source_diversity: { raw_score: 1, weight: 0.1, weighted: 0.1 },
    relevance: {
      raw_score: 0.8,
      weight: 0.35,
      weighted: 0.28,
      topicBreakdown: {
        'software-development': {
          postScore: 1,
          communityWeight: 0.8,
          contribution: 0.8,
        },
      },
    },
  },
  counterfactual: {
    pure_engagement_rank: 3,
    community_governed_rank: 1,
    difference: 2,
  },
  scored_at: '2026-07-07T07:44:21.844Z',
} satisfies ExplanationFixture;

describe('web-next live demo data helpers', () => {
  it('builds Bluesky source URLs from AT Protocol post URIs', () => {
    expect(bskyPostUrlFromAtUri('at://did:plc:example123/app.bsky.feed.post/3abc')).toBe(
      'https://bsky.app/profile/did:plc:example123/post/3abc',
    );
  });

  it('rejects non-post AT Protocol URIs', () => {
    expect(() => bskyPostUrlFromAtUri('at://did:plc:example123/app.bsky.feed.generator/demo')).toThrow(
      LiveDemoDataError,
    );
  });

  it('rejects malformed AT Protocol post URI input', () => {
    expect(() => bskyPostUrlFromAtUri('not-an-at-uri')).toThrow(LiveDemoDataError);
    expect(() => bskyPostUrlFromAtUri('')).toThrow(LiveDemoDataError);
  });

  it('hydrates multiple feed skeleton URIs with repeated AppView params', () => {
    const url = new URL(
      buildPostHydrationUrl([
        'at://did:plc:first/app.bsky.feed.post/3one',
        'at://did:plc:second/app.bsky.feed.post/3two',
      ]),
    );

    expect(url.origin).toBe('https://public.api.bsky.app');
    expect(url.pathname).toBe('/xrpc/app.bsky.feed.getPosts');
    expect(url.searchParams.getAll('uris')).toEqual([
      'at://did:plc:first/app.bsky.feed.post/3one',
      'at://did:plc:second/app.bsky.feed.post/3two',
    ]);
  });

  it('builds an AppView hydration URL with no URI params for an empty feed', () => {
    const url = new URL(buildPostHydrationUrl([]));

    expect(url.origin).toBe('https://public.api.bsky.app');
    expect(url.pathname).toBe('/xrpc/app.bsky.feed.getPosts');
    expect(url.searchParams.getAll('uris')).toEqual([]);
  });

  it('normalizes live explanation components in display order', () => {
    const components = scoreComponentsFromExplanation(EXPLANATION_FIXTURE);

    expect(components.map((component) => component.key)).toEqual([
      'recency',
      'engagement',
      'bridging',
      'source_diversity',
      'relevance',
    ]);
    expect(components[4]?.weighted).toBe(0.28);
  });

  it('fails explicitly when a required live explanation component is missing', () => {
    const { relevance: _relevance, ...componentsWithoutRelevance } = EXPLANATION_FIXTURE.components;

    expect(() =>
      scoreComponentsFromExplanation({
        ...EXPLANATION_FIXTURE,
        components: componentsWithoutRelevance,
      }),
    ).toThrow(LiveDemoDataError);
  });

  it('fails explicitly when live explanation component fields are non-finite', () => {
    expect(() =>
      scoreComponentsFromExplanation({
        ...EXPLANATION_FIXTURE,
        components: {
          ...EXPLANATION_FIXTURE.components,
          recency: {
            ...EXPLANATION_FIXTURE.components.recency,
            raw_score: Number.NaN,
          },
        },
      }),
    ).toThrow(LiveDemoDataError);

    expect(() =>
      scoreComponentsFromExplanation({
        ...EXPLANATION_FIXTURE,
        components: {
          ...EXPLANATION_FIXTURE.components,
          relevance: {
            ...EXPLANATION_FIXTURE.components.relevance,
            weighted: Number.POSITIVE_INFINITY,
          },
        },
      }),
    ).toThrow(LiveDemoDataError);
  });

  it('normalizes live relevance topic breakdowns', () => {
    expect(topicBreakdownFromExplanation(EXPLANATION_FIXTURE)).toEqual([
      {
        slug: 'software-development',
        name: 'Software Development',
        postScore: 1,
        communityWeight: 0.8,
        contribution: 0.8,
      },
    ]);
  });

  it('returns an empty topic list when relevance topic breakdown is absent or empty', () => {
    expect(
      topicBreakdownFromExplanation({
        ...EXPLANATION_FIXTURE,
        components: {
          ...EXPLANATION_FIXTURE.components,
          relevance: {
            raw_score: 0.8,
            weight: 0.35,
            weighted: 0.28,
          },
        },
      }),
    ).toEqual([]);

    expect(
      topicBreakdownFromExplanation({
        ...EXPLANATION_FIXTURE,
        components: {
          ...EXPLANATION_FIXTURE.components,
          relevance: {
            raw_score: 0.8,
            weight: 0.35,
            weighted: 0.28,
            topicBreakdown: {},
          },
        },
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  feedUriForCommunity,
  feedUriForRkey,
  getFeedCommunities,
  isFeedCommunityServable,
  publicFeedUris,
  resolveFeedCommunityByRkey,
  resolveFeedCommunityByUri,
  type FeedCommunity,
} from '../src/feed/community-registry.js';
import { registerDescribeGenerator } from '../src/feed/routes/describe-generator.js';
import { buildTestApp } from './helpers/index.js';

describe('feed community registry', () => {
  it('resolves the public community-gov feed and keeps Birders disabled by default', () => {
    const communities = getFeedCommunities();
    const communityGov = resolveFeedCommunityByRkey('community-gov', communities);
    const birders = resolveFeedCommunityByRkey('birders-who-code', communities);

    expect(communityGov?.communityId).toBe('community-gov');
    expect(communityGov?.status).toBe('enabled');
    expect(communityGov?.public).toBe(true);
    expect(birders?.communityId).toBe('birders_who_code');
    expect(birders?.status).toBe('disabled');
    expect(birders?.public).toBe(false);
    expect(birders?.redis.current).toBe('feed:community:birders_who_code:current');
  });

  it('advertises only public enabled feeds by default', () => {
    const uris = publicFeedUris(getFeedCommunities(), config.FEEDGEN_PUBLISHER_DID);

    expect(uris).toEqual([
      `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`,
    ]);
  });

  it('resolves feed URIs from caller-provided registry entries', () => {
    const birders = resolveFeedCommunityByRkey('birders-who-code', getFeedCommunities());
    if (!birders) {
      throw new Error('Birders community fixture missing from registry');
    }
    const enabledBirders: FeedCommunity = {
      ...birders,
      status: 'enabled',
      public: true,
    };
    const uri = feedUriForCommunity(enabledBirders, config.FEEDGEN_PUBLISHER_DID);

    expect(resolveFeedCommunityByUri(uri, config.FEEDGEN_PUBLISHER_DID, [enabledBirders])).toEqual(enabledBirders);
  });

  it('returns null for unknown or empty registry lookups', () => {
    expect(resolveFeedCommunityByRkey('unknown', getFeedCommunities())).toBeNull();
    expect(resolveFeedCommunityByUri(
      feedUriForRkey('unknown', config.FEEDGEN_PUBLISHER_DID),
      config.FEEDGEN_PUBLISHER_DID,
      getFeedCommunities()
    )).toBeNull();
    expect(resolveFeedCommunityByRkey('community-gov', [])).toBeNull();
    expect(publicFeedUris([], config.FEEDGEN_PUBLISHER_DID)).toEqual([]);
  });

  it('serves only enabled registry entries', () => {
    const communities = getFeedCommunities();
    const communityGov = resolveFeedCommunityByRkey('community-gov', communities);
    const birders = resolveFeedCommunityByRkey('birders-who-code', communities);
    if (!communityGov || !birders) {
      throw new Error('Feed community fixtures missing from registry');
    }

    expect(isFeedCommunityServable(communityGov)).toBe(true);
    expect(isFeedCommunityServable(birders)).toBe(false);
  });
});

describe('describeFeedGenerator community visibility', () => {
  it('hides disabled/private Birders from default discovery', async () => {
    const app = buildTestApp();
    registerDescribeGenerator(app);

    const response = await app.inject({
      method: 'GET',
      url: '/xrpc/app.bsky.feed.describeFeedGenerator',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      did: config.FEEDGEN_SERVICE_DID,
      feeds: [
        {
          uri: `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`,
        },
      ],
    });

    await app.close();
  });
});

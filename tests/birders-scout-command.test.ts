import { describe, expect, it } from 'vitest';
import {
  BirdersScoutHelpRequested,
  birdersScoutUsage,
  parseBirdersScoutArgs,
  renderBirdersScoutReport,
  resolveBirdersCommunity,
} from '../src/feed/birders-scout-command.js';

describe('Birders scout command helpers', () => {
  it('parses read-only scout defaults', () => {
    expect(parseBirdersScoutArgs([])).toEqual({
      mode: 'scout',
      json: false,
      windowHours: 72,
      limit: 500,
    });
  });

  it('parses explicit JSON materialize options', () => {
    expect(parseBirdersScoutArgs(['--json', '--materialize', '--window-hours=24', '--limit', '75'])).toEqual({
      mode: 'materialize',
      json: true,
      windowHours: 24,
      limit: 75,
    });
  });

  it('rejects invalid numeric options and unknown arguments', () => {
    expect(() => parseBirdersScoutArgs(['--limit=0'])).toThrow('--limit must be a positive integer');
    expect(() => parseBirdersScoutArgs(['--window-hours', '1.5'])).toThrow(
      '--window-hours must be a positive integer'
    );
    expect(() => parseBirdersScoutArgs(['--surprise'])).toThrow('Unknown argument');
  });

  it('uses a typed help signal for help requests', () => {
    expect(() => parseBirdersScoutArgs(['--help'])).toThrow(BirdersScoutHelpRequested);
    expect(birdersScoutUsage()).toContain('Default mode is read-only scout');
  });

  it('resolves the disabled Birders registry entry for scout use', () => {
    const community = resolveBirdersCommunity();

    expect(community.communityId).toBe('birders_who_code');
    expect(community.status).toBe('disabled');
  });

  it('renders the quantitative readiness report', () => {
    const rendered = renderBirdersScoutReport({
      communityId: 'birders_who_code',
      name: 'Birders Who Code',
      status: 'thin',
      source: 'production_scores',
      activeEpochId: 12,
      sampledAt: '2026-07-09T20:00:00.000Z',
      windowHours: 72,
      candidatePosts: 150,
      candidatePostsPerDay: 50,
      uniqueAuthors: 60,
      uniqueAuthorsPerDay: 20,
      bridgePostShare: 0.3,
      topAuthorConcentration: 0.08,
      strongBridgeHighRelevancePosts: 33,
      strongBridgeHighRelevancePostsPerDay: 11,
      samplePostUris: ['at://did:plc:a/app.bsky.feed.post/1'],
      thresholds: {
        candidatePostsPerDay: 100,
        uniqueAuthorsPerDay: 30,
        strongBridgeHighRelevancePostsPerDay: 10,
      },
      warnings: ['Birders supply is below the readiness threshold; keep the feed disabled.'],
    });

    expect(rendered).toContain('Candidates: 150 (50.0/day; threshold 100/day)');
    expect(rendered).toContain('Bridge-post share: 30.0%');
    expect(rendered).toContain('Top-author concentration: 8.0%');
  });
});

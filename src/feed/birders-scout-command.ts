import {
  type CommunityScoutReport,
  type MaterializedCommunityFeedResult,
} from './community-materializer.js';
import {
  getFeedCommunities,
  resolveFeedCommunityByRkey,
  type FeedCommunity,
} from './community-registry.js';

export type BirdersScoutMode = 'scout' | 'materialize';

export interface BirdersScoutCommandOptions {
  mode: BirdersScoutMode;
  json: boolean;
  windowHours: number;
  limit: number;
}

export function parseBirdersScoutArgs(argv: readonly string[]): BirdersScoutCommandOptions {
  const options: BirdersScoutCommandOptions = {
    mode: 'scout',
    json: false,
    windowHours: 72,
    limit: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--materialize') {
      options.mode = 'materialize';
    } else if (arg === '--window-hours') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('--window-hours requires a value');
      }
      options.windowHours = parsePositiveInteger(value, '--window-hours');
      index += 1;
    } else if (arg.startsWith('--window-hours=')) {
      options.windowHours = parsePositiveInteger(arg.slice('--window-hours='.length), '--window-hours');
    } else if (arg === '--limit') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('--limit requires a value');
      }
      options.limit = parsePositiveInteger(value, '--limit');
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--help' || arg === '-h') {
      throw new BirdersScoutHelpRequested();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export class BirdersScoutHelpRequested extends Error {
  constructor() {
    super('Help requested');
    this.name = 'BirdersScoutHelpRequested';
  }
}

export function birdersScoutUsage(): string {
  return [
    'Usage: npx tsx scripts/birders-feed-scout.ts [--json] [--window-hours N] [--limit N] [--materialize]',
    '',
    'Default mode is read-only scout. --materialize writes only feed:community:birders_who_code:* Redis keys.',
  ].join('\n');
}

export function resolveBirdersCommunity(): FeedCommunity {
  const community = resolveFeedCommunityByRkey('birders-who-code', getFeedCommunities());
  if (community === null) {
    throw new Error('birders-who-code community is missing from the feed registry');
  }
  return community;
}

export function renderBirdersScoutReport(report: CommunityScoutReport): string {
  return [
    `${report.name} readiness: ${report.status}`,
    `Active production epoch: ${report.activeEpochId ?? 'unavailable'}`,
    `Window: ${report.windowHours}h sampled at ${report.sampledAt}`,
    `Candidates: ${report.candidatePosts} (${formatNumber(report.candidatePostsPerDay)}/day; threshold ${report.thresholds.candidatePostsPerDay}/day)`,
    `Unique authors: ${report.uniqueAuthors} (${formatNumber(report.uniqueAuthorsPerDay)}/day; threshold ${report.thresholds.uniqueAuthorsPerDay}/day)`,
    `Bridge-post share: ${formatPercent(report.bridgePostShare)}`,
    `Top-author concentration: ${formatPercent(report.topAuthorConcentration)}`,
    `Strong bridge/high-relevance posts: ${report.strongBridgeHighRelevancePosts} (${formatNumber(report.strongBridgeHighRelevancePostsPerDay)}/day; threshold ${report.thresholds.strongBridgeHighRelevancePostsPerDay}/day)`,
    `Sample URIs: ${report.samplePostUris.length === 0 ? 'none' : report.samplePostUris.join(', ')}`,
    `Warnings: ${report.warnings.length === 0 ? 'none' : report.warnings.join(' | ')}`,
  ].join('\n');
}

export function renderBirdersMaterializeResult(result: MaterializedCommunityFeedResult): string {
  return [
    renderBirdersScoutReport(result.report),
    `Materialized ranked posts: ${result.rankedCount}`,
    `Redis keys written: ${result.redisKeysWritten.join(', ')}`,
  ].join('\n');
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer; received ${value}`);
  }
  return parsed;
}

function formatNumber(value: number): string {
  return value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

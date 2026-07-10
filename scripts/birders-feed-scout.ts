import {
  BirdersScoutHelpRequested,
  birdersScoutUsage,
  parseBirdersScoutArgs,
  renderBirdersMaterializeResult,
  renderBirdersScoutReport,
  resolveBirdersCommunity,
} from '../src/feed/birders-scout-command.js';

async function main(): Promise<void> {
  const options = parseOptionsOrPrintHelp(process.argv.slice(2));
  if (options === null) {
    return;
  }

  const [{ db }, { redis }, { materializeCommunityFeed, scoutCommunityFeed }] = await Promise.all([
    import('../src/db/client.js'),
    import('../src/db/redis.js'),
    import('../src/feed/community-materializer.js'),
  ]);

  try {
    const community = resolveBirdersCommunity();
    const now = new Date();

    if (options.mode === 'materialize') {
      const result = await materializeCommunityFeed({
        community,
        dbPool: db,
        redisClient: redis,
        now,
        windowHours: options.windowHours,
        limit: options.limit,
      });
      console.log(options.json ? JSON.stringify(result, null, 2) : renderBirdersMaterializeResult(result));
      return;
    }

    const report = await scoutCommunityFeed({
      community,
      dbPool: db,
      now,
      windowHours: options.windowHours,
      limit: options.limit,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : renderBirdersScoutReport(report));
  } finally {
    redis.disconnect();
    await db.end();
  }
}

function parseOptionsOrPrintHelp(argv: readonly string[]): ReturnType<typeof parseBirdersScoutArgs> | null {
  try {
    return parseBirdersScoutArgs(argv);
  } catch (err) {
    if (err instanceof BirdersScoutHelpRequested) {
      console.log(birdersScoutUsage());
      return null;
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Birders scout failed: ${message}`);
  process.exitCode = 1;
});

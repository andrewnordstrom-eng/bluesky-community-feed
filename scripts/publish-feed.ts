/**
 * publish-feed.ts
 *
 * Registers the feed generator with the Bluesky network.
 * Run this after:
 * 1. Your server is deployed and accessible via HTTPS
 * 2. You have configured FEEDGEN_SERVICE_DID in .env
 * 3. You have configured BSKY_IDENTIFIER and BSKY_APP_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/publish-feed.ts
 *
 * This creates an app.bsky.feed.generator record in your Bluesky repo,
 * which makes the feed discoverable and subscribable.
 */

import { BskyAgent } from '@atproto/api';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('=== Feed Publisher ===\n');

  // Validate required env vars
  const required = ['BSKY_IDENTIFIER', 'BSKY_APP_PASSWORD', 'FEEDGEN_SERVICE_DID'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Error: ${key} must be set in .env`);
      process.exit(1);
    }
  }

  const identifier = process.env.BSKY_IDENTIFIER!;
  const password = process.env.BSKY_APP_PASSWORD!;
  const serviceDid = process.env.FEEDGEN_SERVICE_DID!;

  console.log(`Logging in as: ${identifier}`);

  // Create agent and login
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  try {
    await agent.login({
      identifier,
      password,
    });
  } catch (err) {
    console.error('Login failed. Check your BSKY_IDENTIFIER and BSKY_APP_PASSWORD.');
    console.error('Make sure you are using an App Password, not your main password.');
    console.error('Create an App Password at: bsky.app > Settings > App Passwords');
    throw err;
  }

  console.log('Login successful!');
  console.log(`Publisher DID: ${agent.session!.did}\n`);

  // The record key (rkey) for the feed - must match what's used in FEED_URI
  const rkey = 'community-gov';

  // Create the feed generator record
  const record = {
    did: serviceDid,
    displayName: 'Community Governed Feed',
    description:
      'A community-governed feed where subscribers vote on algorithm weights and topic priorities. ' +
      '25 steerable topics, transparent scoring, democratic control.',
    acceptsInteractions: true,
    createdAt: new Date().toISOString(),
  };

  console.log('Publishing feed generator record...');
  console.log(`  Service DID: ${serviceDid}`);
  console.log(`  Record key: ${rkey}`);
  console.log('');

  try {
    await agent.api.com.atproto.repo.putRecord({
      repo: agent.session!.did,
      collection: 'app.bsky.feed.generator',
      rkey,
      record,
    });

    const feedUri = `at://${agent.session!.did}/app.bsky.feed.generator/${rkey}`;

    console.log('=== Success! ===\n');
    console.log('Feed published successfully!');
    console.log(`Feed URI: ${feedUri}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Update FEEDGEN_PUBLISHER_DID in .env to:', agent.session!.did);
    console.log('2. The feed should now appear when searching in Bluesky');
    console.log('3. Users can find it by searching for "Community Governed Feed"');
    console.log('');
    console.log('To unpublish later:');
    console.log(`  npx tsx scripts/unpublish-feed.ts`);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 400) {
      console.log('Feed record already exists. Updating...');
      // Record exists, try to update it
      await agent.api.com.atproto.repo.putRecord({
        repo: agent.session!.did,
        collection: 'app.bsky.feed.generator',
        rkey,
        record,
      });
      console.log('Feed record updated successfully!');
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

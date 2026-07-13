import { AppBskyFeedGenerator, BskyAgent } from '@atproto/api';
import dotenv from 'dotenv';

dotenv.config();

const COLLECTION = 'app.bsky.feed.generator';
const FEED_RKEY = 'community-gov';
const DISPLAY_NAME = 'Corgi Commons';
const DESCRIPTION = 'Corgi Commons is a Bluesky feed shaped by community votes on ranking signals, topic priorities, and content rules. Inspect policies and ranking receipts at feed.corgi.network.';

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable is missing: ${name}`);
  }
  return value;
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown feed-record update failure';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const identifier = requireEnvironmentValue('BSKY_IDENTIFIER');
  const password = requireEnvironmentValue('BSKY_APP_PASSWORD');
  const expectedServiceDid = requireEnvironmentValue('FEEDGEN_SERVICE_DID');
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  await agent.login({ identifier, password });
  const publisherDid = agent.session?.did;
  if (!publisherDid) {
    throw new Error('Bluesky login completed without a publisher DID');
  }

  const currentResponse = await agent.api.com.atproto.repo.getRecord({
    repo: publisherDid,
    collection: COLLECTION,
    rkey: FEED_RKEY,
  });
  const validation = AppBskyFeedGenerator.validateRecord(currentResponse.data.value);
  if (!validation.success) {
    throw new Error(`Existing ${COLLECTION}/${FEED_RKEY} record failed lexicon validation`);
  }

  const currentRecord = validation.value;
  if (currentRecord.did !== expectedServiceDid) {
    throw new Error(
      `Refusing to update feed record with unexpected service DID: expected=${expectedServiceDid} actual=${currentRecord.did}`,
    );
  }

  const updatedRecord: AppBskyFeedGenerator.Record = {
    ...currentRecord,
    displayName: DISPLAY_NAME,
    description: DESCRIPTION,
  };

  process.stdout.write(`Publisher DID: ${publisherDid}\n`);
  process.stdout.write(`Record: ${COLLECTION}/${FEED_RKEY}\n`);
  process.stdout.write(`Current display name: ${currentRecord.displayName}\n`);
  process.stdout.write(`Target display name: ${DISPLAY_NAME}\n`);

  if (currentRecord.displayName === DISPLAY_NAME && currentRecord.description === DESCRIPTION) {
    process.stdout.write('Feed record already matches the approved Corgi Commons copy.\n');
    return;
  }

  if (!apply) {
    process.stdout.write('Dry run only. Re-run with --apply after reviewing the target copy.\n');
    return;
  }

  await agent.api.com.atproto.repo.putRecord({
    repo: publisherDid,
    collection: COLLECTION,
    rkey: FEED_RKEY,
    record: updatedRecord,
    swapRecord: currentResponse.data.cid,
  });

  const verificationResponse = await agent.api.com.atproto.repo.getRecord({
    repo: publisherDid,
    collection: COLLECTION,
    rkey: FEED_RKEY,
  });
  const verification = AppBskyFeedGenerator.validateRecord(verificationResponse.data.value);
  if (!verification.success) {
    throw new Error('Updated feed record failed lexicon validation');
  }
  if (verification.value.displayName !== DISPLAY_NAME || verification.value.description !== DESCRIPTION) {
    throw new Error('Feed record verification did not match the approved Corgi Commons copy');
  }

  process.stdout.write(`Updated feed record at CID ${verificationResponse.data.cid}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Corgi Commons feed-record update failed: ${errorSummary(error)}\n`);
  process.exitCode = 1;
});

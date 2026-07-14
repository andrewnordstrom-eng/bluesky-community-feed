import { Agent, AppBskyFeedGenerator, CredentialSession, XRPCError } from '@atproto/api';
import dotenv from 'dotenv';

dotenv.config();

const COLLECTION = 'app.bsky.feed.generator';
const FEED_RKEY = 'community-gov';
const DISPLAY_NAME = 'Corgi Commons';
const DESCRIPTION = 'Corgi Commons is a Bluesky feed shaped by community votes on ranking signals, topic priorities, and content rules. Inspect policies and ranking receipts at feed.corgi.network.';
const BSKY_SERVICE = new URL('https://bsky.social');
const NETWORK_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof globalThis.fetch = async (input, init) => {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(new Error(`Bluesky request timed out after ${NETWORK_TIMEOUT_MS}ms`));
  }, NETWORK_TIMEOUT_MS);
  const signals = init?.signal
    ? [init.signal, timeoutController.signal]
    : [timeoutController.signal];

  try {
    return await globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !init?.signal?.aborted) {
      throw new Error(`Bluesky request timed out after ${NETWORK_TIMEOUT_MS}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable is missing: ${name}`);
  }
  return value;
}

function errorSummary(error: unknown): string {
  if (error instanceof XRPCError) {
    return `${error.error} (HTTP ${error.status}): ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown feed-record update failure';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const identifier = requireEnvironmentValue('BSKY_IDENTIFIER');
  const password = requireEnvironmentValue('BSKY_APP_PASSWORD');
  const session = new CredentialSession(BSKY_SERVICE, fetchWithTimeout);
  const agent = new Agent(session);

  await session.login({ identifier, password });
  const publisherDid = agent.did;
  if (!publisherDid) {
    throw new Error('Bluesky login completed without a publisher DID');
  }

  const currentResponse = await agent.com.atproto.repo.getRecord({
    repo: publisherDid,
    collection: COLLECTION,
    rkey: FEED_RKEY,
  });
  const expectedRecordUri = `at://${publisherDid}/${COLLECTION}/${FEED_RKEY}`;
  if (currentResponse.data.uri !== expectedRecordUri) {
    throw new Error(
      `Refusing to update an unexpected feed record: expected=${expectedRecordUri} actual=${currentResponse.data.uri}`,
    );
  }
  const validation = AppBskyFeedGenerator.validateRecord(currentResponse.data.value);
  if (!validation.success) {
    throw new Error(`Existing ${COLLECTION}/${FEED_RKEY} record failed lexicon validation`);
  }

  const currentRecord = validation.value;
  const currentServiceDid = currentRecord.did;
  if (!currentServiceDid.startsWith('did:')) {
    throw new Error(`Existing feed record has an invalid service DID: ${currentServiceDid}`);
  }

  const updatedRecord: AppBskyFeedGenerator.Record = {
    ...currentRecord,
    displayName: DISPLAY_NAME,
    description: DESCRIPTION,
  };

  process.stdout.write(`Publisher DID: ${publisherDid}\n`);
  process.stdout.write(`Record: ${COLLECTION}/${FEED_RKEY}\n`);
  process.stdout.write(`Preserved service DID: ${currentServiceDid}\n`);
  process.stdout.write(`Current display name: ${currentRecord.displayName}\n`);
  process.stdout.write(`Target display name: ${DISPLAY_NAME}\n`);
  process.stdout.write(`Current description: ${currentRecord.description ?? '<none>'}\n`);
  process.stdout.write(`Target description: ${DESCRIPTION}\n`);

  if (currentRecord.displayName === DISPLAY_NAME && currentRecord.description === DESCRIPTION) {
    process.stdout.write('Feed record already matches the approved Corgi Commons copy.\n');
    return;
  }

  if (!apply) {
    process.stdout.write('Dry run only. Re-run with --apply after reviewing the target copy.\n');
    return;
  }

  try {
    await agent.com.atproto.repo.putRecord({
      repo: publisherDid,
      collection: COLLECTION,
      rkey: FEED_RKEY,
      record: updatedRecord,
      swapRecord: currentResponse.data.cid,
    });
  } catch (error) {
    if (error instanceof XRPCError && /swap|cid|conflict/i.test(`${error.error} ${error.message}`)) {
      throw new Error(
        `Feed record changed after the dry run; compare-and-swap refused the update. Re-run without --apply and review the latest record. ${errorSummary(error)}`,
        { cause: error },
      );
    }
    throw error;
  }

  const verificationResponse = await agent.com.atproto.repo.getRecord({
    repo: publisherDid,
    collection: COLLECTION,
    rkey: FEED_RKEY,
  });
  const verification = AppBskyFeedGenerator.validateRecord(verificationResponse.data.value);
  if (!verification.success) {
    throw new Error('Updated feed record failed lexicon validation');
  }
  if (
    verification.value.did !== currentServiceDid
    || verification.value.displayName !== DISPLAY_NAME
    || verification.value.description !== DESCRIPTION
  ) {
    throw new Error('Feed record verification did not match the approved Corgi Commons copy');
  }

  process.stdout.write(`Updated feed record at CID ${verificationResponse.data.cid}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Corgi Commons feed-record update failed: ${errorSummary(error)}\n`);
  process.exitCode = 1;
});

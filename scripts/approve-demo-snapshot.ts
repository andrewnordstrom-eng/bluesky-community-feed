import { readFile, writeFile } from 'node:fs/promises';
import {
  COMMUNITY_GOV_FEED_NAME,
  DEMO_SOURCE_SNAPSHOT_LIMIT,
  communityGovManifestDigest,
  parseApprovedSnapshotManifest,
} from '../src/feed/demo-snapshot-source.js';

interface ApprovalOptions {
  manifestPath: string;
  outputPath: string;
  reviewedAt: string;
  reviewAcknowledged: boolean;
}

function parseOptions(args: readonly string[]): ApprovalOptions {
  const values = new Map<string, string>();
  let reviewAcknowledged = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--review-acknowledged') {
      reviewAcknowledged = true;
      continue;
    }
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected snapshot approval argument: ${String(argument)}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Snapshot approval argument requires a value: ${argument}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }

  const manifestPath = values.get('manifest');
  const outputPath = values.get('output');
  const reviewedAtInput = values.get('reviewed-at');
  if (!manifestPath || !outputPath || !reviewedAtInput || !reviewAcknowledged) {
    throw new Error(
      'Expected --manifest, --output, --reviewed-at, and --review-acknowledged after every eligible review-sheet row has been checked',
    );
  }
  if (manifestPath === outputPath) {
    throw new Error('Snapshot approval refuses to overwrite the unapproved capture manifest in place');
  }
  const reviewedAtDate = new Date(reviewedAtInput);
  if (Number.isNaN(reviewedAtDate.getTime())) {
    throw new Error(`Snapshot review timestamp is invalid: ${reviewedAtInput}`);
  }

  return {
    manifestPath,
    outputPath,
    reviewedAt: reviewedAtDate.toISOString(),
    reviewAcknowledged,
  };
}

function asManifestRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Captured snapshot manifest must be a JSON object');
  }
  return input as Record<string, unknown>;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options.reviewAcknowledged) {
    throw new Error('Snapshot review acknowledgement is required');
  }

  const captured = asManifestRecord(JSON.parse(await readFile(options.manifestPath, 'utf8')) as unknown);
  if (captured.feedName !== COMMUNITY_GOV_FEED_NAME) {
    throw new Error(
      `Snapshot feed name must be ${COMMUNITY_GOV_FEED_NAME}: received ${String(captured.feedName)}`,
    );
  }
  if (captured.reviewedAt !== null) {
    throw new Error('Snapshot capture must be unapproved before review acknowledgement');
  }
  if (!Array.isArray(captured.entries) || captured.entries.length !== DEMO_SOURCE_SNAPSHOT_LIMIT) {
    throw new Error(
      `Snapshot capture must contain exactly ${DEMO_SOURCE_SNAPSHOT_LIMIT} ordered source entries`,
    );
  }
  const capturedDigest = captured.snapshotDigest;
  const computedCapturedDigest = communityGovManifestDigest(captured);
  if (capturedDigest !== computedCapturedDigest) {
    throw new Error(
      `Captured snapshot digest mismatch: expected=${String(capturedDigest)} computed=${computedCapturedDigest}`,
    );
  }

  const approvedWithoutDigest: Record<string, unknown> = {
    ...captured,
    reviewedAt: options.reviewedAt,
  };
  const approved = {
    ...approvedWithoutDigest,
    snapshotDigest: communityGovManifestDigest(approvedWithoutDigest),
  };
  parseApprovedSnapshotManifest(approved);

  await writeFile(options.outputPath, `${JSON.stringify(approved, null, 2)}\n`, 'utf8');
  process.stdout.write(`Approved Corgi Commons snapshot: ${options.outputPath}\n`);
  process.stdout.write(`Reviewed at: ${options.reviewedAt}\n`);
  process.stdout.write(`Snapshot digest: ${approved.snapshotDigest}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Corgi Commons snapshot approval failed: ${message}\n`);
  process.exitCode = 1;
});

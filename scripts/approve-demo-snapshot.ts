import { readFile, writeFile } from 'node:fs/promises';
import {
  COMMUNITY_GOV_FEED_NAME,
  DEMO_SOURCE_SNAPSHOT_LIMIT,
  communityGovManifestDigest,
  parseApprovedSnapshotManifest,
} from '../src/feed/demo-snapshot-source.js';
import {
  captureReportApprovalFailures,
  parseSnapshotCaptureReport,
  snapshotApprovalWriteFlag,
} from '../src/demo/snapshot-capture.js';

interface ApprovalOptions {
  manifestPath: string;
  reportPath: string;
  outputPath: string;
  reviewedAt: string;
  reviewAcknowledged: boolean;
  force: boolean;
}

function parseOptions(args: readonly string[]): ApprovalOptions {
  const values = new Map<string, string>();
  let reviewAcknowledged = false;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--review-acknowledged') {
      reviewAcknowledged = true;
      continue;
    }
    if (argument === '--force') {
      force = true;
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
  const reportPath = values.get('report');
  const outputPath = values.get('output');
  const reviewedAtInput = values.get('reviewed-at');
  if (!manifestPath || !reportPath || !outputPath || !reviewedAtInput || !reviewAcknowledged) {
    throw new Error(
      'Expected --manifest, --report, --output, --reviewed-at, and --review-acknowledged after every eligible review-sheet row has been checked',
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
    reportPath,
    outputPath,
    reviewedAt: reviewedAtDate.toISOString(),
    reviewAcknowledged,
    force,
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
  if (typeof capturedDigest !== 'string') {
    throw new Error('Captured snapshot digest must be a string');
  }
  const report = parseSnapshotCaptureReport(
    JSON.parse(await readFile(options.reportPath, 'utf8')) as unknown
  );
  const reportFailures = captureReportApprovalFailures(report, capturedDigest);
  if (reportFailures.length > 0) {
    throw new Error(`Snapshot capture report is not approval-ready: ${reportFailures.join('; ')}`);
  }
  if (report.productionEpochId !== captured.productionEpochId || report.sourceRunId !== captured.sourceRunId) {
    throw new Error(
      'Snapshot capture report provenance does not match the captured manifest production epoch and run'
    );
  }
  if (report.sourceCount !== captured.entries.length) {
    throw new Error(
      `Snapshot capture report source count ${report.sourceCount} does not match manifest entries ${captured.entries.length}`
    );
  }
  if (report.capturedAt !== captured.capturedAt) {
    throw new Error('Snapshot capture report timestamp does not match the captured manifest');
  }
  const reviewedEntries = captured.entries.filter((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const frozen = (entry as Record<string, unknown>).frozen;
    if (frozen === null || typeof frozen !== 'object' || Array.isArray(frozen)) return false;
    return typeof (frozen as Record<string, unknown>).reviewedCid === 'string';
  });
  if (report.eligibleCount !== reviewedEntries.length || report.displayableCount !== reviewedEntries.length) {
    throw new Error(
      `Snapshot capture report public counts do not match ${reviewedEntries.length} CID-bound manifest entries`
    );
  }
  const reviewedAuthorCounts = new Map<string, number>();
  for (const entry of reviewedEntries) {
    const frozen = (entry as Record<string, unknown>).frozen as Record<string, unknown>;
    const authorDid = frozen.authorDid;
    if (typeof authorDid !== 'string') {
      throw new Error('CID-bound snapshot entry is missing its frozen author DID');
    }
    reviewedAuthorCounts.set(authorDid, (reviewedAuthorCounts.get(authorDid) ?? 0) + 1);
  }
  const highestAuthorCount = Math.max(0, ...reviewedAuthorCounts.values());
  const manifestTopAuthorConcentration = reviewedEntries.length === 0
    ? 0
    : Number((highestAuthorCount / reviewedEntries.length).toFixed(3));
  if (
    report.uniqueAuthorCount !== reviewedAuthorCounts.size
    || report.topAuthorConcentration !== manifestTopAuthorConcentration
  ) {
    throw new Error('Snapshot capture report authorship metrics do not match the CID-bound manifest entries');
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

  try {
    await writeFile(options.outputPath, `${JSON.stringify(approved, null, 2)}\n`, {
      encoding: 'utf8',
      flag: snapshotApprovalWriteFlag(options.force),
    });
  } catch (error) {
    if (
      error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'EEXIST'
    ) {
      throw new Error(
        `Approved snapshot output already exists: ${options.outputPath}. Review it or pass --force to replace it explicitly.`
      );
    }
    throw error;
  }
  process.stdout.write(`Approved Corgi Commons snapshot: ${options.outputPath}\n`);
  process.stdout.write(`Reviewed at: ${options.reviewedAt}\n`);
  process.stdout.write(`Snapshot digest: ${approved.snapshotDigest}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Corgi Commons snapshot approval failed: ${message}\n`);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { assertSha256, canonicalJson, hashCanonicalJson } from '../governance/policy-version.js';
import type {
  JsonObject,
  RankedSlateItem,
  RankingPublicationMetadata,
  RankingReceipt,
  RankingRunInputEnvelope,
  RankingRunState,
} from '../shared/ranking-contracts.js';

const TERMINAL_STATES = new Set<RankingRunState>([
  'published',
  'failed',
  'superseded',
  'rejected',
]);

const ALLOWED_TRANSITIONS: Readonly<Record<RankingRunState, readonly RankingRunState[]>> = {
  requested: ['running', 'failed', 'superseded', 'rejected'],
  running: ['validated', 'failed', 'superseded', 'rejected'],
  validated: ['published', 'failed', 'superseded', 'rejected'],
  published: [],
  failed: [],
  superseded: [],
  rejected: [],
};

interface RankingRunRow {
  id: string;
  community_id: string;
  policy_version_id: string;
  policy_hash: string;
  algorithm_version: string;
  configuration_hash: string;
  code_sha: string;
  as_of: Date | string;
  state: RankingRunState;
  selected_count: number;
  snapshot_id: string | null;
  receipt_checksum: string | null;
}

interface RankingInputRow {
  payload: Buffer;
  checksum: string;
  candidate_count: number;
  uncompressed_bytes: number | string;
  compressed_bytes: number | string;
}

interface RankingItemIdentityRow {
  position: number;
  post_uri: string;
  post_created_at: Date | string;
}

export interface CompressedRankingInput {
  payload: Buffer;
  checksum: string;
  candidateCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
}

export interface CreateRankingRunInput {
  runId: string;
  communityId: string;
  policyVersionId: string;
  policyHash: string;
  algorithmVersion: string;
  configurationHash: string;
  codeSha: string;
  asOf: string;
}

export interface ValidateRankingRunInput {
  runId: string;
  receipt: RankingReceipt;
  candidateCount: number;
  exclusionCount: number;
  timings: JsonObject;
  metrics: JsonObject;
}

export interface PreparePublicationResult {
  publishable: boolean;
  currentPolicyHash: string;
  replacementRequestId: string | null;
}

export interface CleanupRankingDataResult {
  deletedInputs: number;
  deletedRuns: number;
}

export interface EnqueueRankingRequestInput {
  idempotencyKey: string;
  communityId: string;
  requestKind: 'scheduled' | 'manual' | 'replacement' | 'reconciliation';
  requestedBy: string | null;
  notBefore: string;
}

export function assertRankingRunTransition(
  currentState: RankingRunState,
  nextState: RankingRunState
): void {
  if (!ALLOWED_TRANSITIONS[currentState].includes(nextState)) {
    throw new Error(`Invalid ranking run transition ${currentState} -> ${nextState}`);
  }
}

export function isTerminalRankingRunState(state: RankingRunState): boolean {
  return TERMINAL_STATES.has(state);
}

export function createCompressedRankingInput(
  envelope: RankingRunInputEnvelope
): CompressedRankingInput {
  validateInputEnvelope(envelope);
  const canonical = canonicalJson(envelope);
  const uncompressed = Buffer.from(canonical, 'utf8');
  const payload = gzipSync(uncompressed, { level: 9 });
  return {
    payload,
    checksum: sha256Buffer(uncompressed),
    candidateCount: envelope.candidates.length,
    uncompressedBytes: uncompressed.byteLength,
    compressedBytes: payload.byteLength,
  };
}

export function decodeCompressedRankingInput(
  compressed: CompressedRankingInput
): RankingRunInputEnvelope {
  assertSha256(compressed.checksum, 'ranking input checksum');
  if (compressed.payload.byteLength !== compressed.compressedBytes) {
    throw new Error(
      `Compressed ranking input byte count mismatch: expected ${compressed.compressedBytes}, got ${compressed.payload.byteLength}`
    );
  }
  const uncompressed = gunzipSync(compressed.payload);
  if (uncompressed.byteLength !== compressed.uncompressedBytes) {
    throw new Error(
      `Uncompressed ranking input byte count mismatch: expected ${compressed.uncompressedBytes}, got ${uncompressed.byteLength}`
    );
  }
  const actualChecksum = sha256Buffer(uncompressed);
  if (actualChecksum !== compressed.checksum) {
    throw new Error(
      `Ranking input checksum mismatch: expected ${compressed.checksum}, got ${actualChecksum}`
    );
  }

  const raw = uncompressed.toString('utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (canonicalJson(parsed) !== raw) {
    throw new Error('Ranking input payload is not canonical JSON');
  }
  validateInputEnvelope(parsed);
  if (parsed.candidates.length !== compressed.candidateCount) {
    throw new Error(
      `Ranking input candidate count mismatch: expected ${compressed.candidateCount}, got ${parsed.candidates.length}`
    );
  }
  return parsed;
}

export function buildRankingReceipt(input: {
  runId: string;
  communityId: string;
  policyVersionId: string;
  policyHash: string;
  algorithmVersion: string;
  configurationHash: string;
  codeSha: string;
  asOf: string;
  inputChecksum: string;
  items: readonly RankedSlateItem[];
}): RankingReceipt {
  assertSha256(input.policyHash, 'policyHash');
  assertSha256(input.configurationHash, 'configurationHash');
  assertSha256(input.inputChecksum, 'inputChecksum');
  assertIsoTimestamp(input.asOf, 'asOf');
  validateRankedItems(input.items);

  const itemOrderChecksum = hashCanonicalJson(
    input.items.map((item) => [item.position, item.postUri, item.postCreatedAt])
  );
  const unsigned = {
    schemaVersion: 1 as const,
    runId: input.runId,
    communityId: input.communityId,
    policyVersionId: input.policyVersionId,
    policyHash: input.policyHash,
    algorithmVersion: input.algorithmVersion,
    configurationHash: input.configurationHash,
    codeSha: input.codeSha,
    asOf: input.asOf,
    itemCount: input.items.length,
    inputChecksum: input.inputChecksum,
    itemOrderChecksum,
  };
  return {
    ...unsigned,
    receiptChecksum: hashCanonicalJson(unsigned),
  };
}

export function validateRankingReceipt(receipt: RankingReceipt): void {
  assertSha256(receipt.policyHash, 'receipt.policyHash');
  assertSha256(receipt.configurationHash, 'receipt.configurationHash');
  assertSha256(receipt.inputChecksum, 'receipt.inputChecksum');
  assertSha256(receipt.itemOrderChecksum, 'receipt.itemOrderChecksum');
  assertSha256(receipt.receiptChecksum, 'receipt.receiptChecksum');
  assertIsoTimestamp(receipt.asOf, 'receipt.asOf');
  if (!Number.isInteger(receipt.itemCount) || receipt.itemCount < 0 || receipt.itemCount > 1000) {
    throw new Error(`receipt.itemCount must be an integer in [0, 1000], got ${receipt.itemCount}`);
  }
  const { receiptChecksum, ...unsigned } = receipt;
  const actual = hashCanonicalJson(unsigned);
  if (actual !== receiptChecksum) {
    throw new Error(`Ranking receipt checksum mismatch: expected ${receiptChecksum}, got ${actual}`);
  }
}

export async function createRankingRun(
  client: PoolClient,
  input: CreateRankingRunInput
): Promise<void> {
  assertSha256(input.policyHash, 'policyHash');
  assertSha256(input.configurationHash, 'configurationHash');
  assertIsoTimestamp(input.asOf, 'asOf');
  if (!/^[0-9a-f]{40,64}$/.test(input.codeSha)) {
    throw new Error('codeSha must be a lowercase 40-64 character hexadecimal digest');
  }
  await client.query(
    `INSERT INTO ranking_runs (
       id, community_id, policy_version_id, policy_hash, as_of,
       code_sha, configuration_hash, algorithm_version, state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested')`,
    [
      input.runId,
      input.communityId,
      input.policyVersionId,
      input.policyHash,
      input.asOf,
      input.codeSha,
      input.configurationHash,
      input.algorithmVersion,
    ]
  );
}

export async function transitionRankingRun(
  client: PoolClient,
  runId: string,
  nextState: RankingRunState,
  failure: JsonObject | null
): Promise<void> {
  const current = await lockRankingRun(client, runId);
  assertRankingRunTransition(current.state, nextState);
  if (nextState === 'failed' && failure === null) {
    throw new Error(`Failure details are required when ranking run ${runId} fails`);
  }
  if (nextState !== 'failed' && failure !== null) {
    throw new Error(`Failure details are only valid for failed ranking runs, got ${nextState}`);
  }
  await client.query(
    `UPDATE ranking_runs
        SET state = $2,
            failure = $3::jsonb
      WHERE id = $1`,
    [runId, nextState, failure === null ? null : canonicalJson(failure)]
  );
}

export async function persistRankingRunInput(
  client: PoolClient,
  runId: string,
  compressed: CompressedRankingInput
): Promise<void> {
  const current = await lockRankingRun(client, runId);
  if (current.state !== 'running') {
    throw new Error(`Ranking input can only be persisted while running, got ${current.state}`);
  }
  const envelope = decodeCompressedRankingInput(compressed);
  assertInputEnvelopeMatchesRun(envelope, current);
  await client.query(
    `INSERT INTO ranking_run_inputs (
       run_id, payload, checksum, candidate_count,
       uncompressed_bytes, compressed_bytes
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      runId,
      compressed.payload,
      compressed.checksum,
      compressed.candidateCount,
      compressed.uncompressedBytes,
      compressed.compressedBytes,
    ]
  );
}

export async function persistRankedSlate(
  client: PoolClient,
  runId: string,
  items: readonly RankedSlateItem[]
): Promise<void> {
  const current = await lockRankingRun(client, runId);
  if (current.state !== 'running') {
    throw new Error(`Ranked slate can only be persisted while running, got ${current.state}`);
  }
  validateRankedItems(items);
  if (items.length === 0) {
    throw new Error(`Ranking run ${runId} cannot persist an empty published slate`);
  }

  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (const item of items) {
    const offset = values.length;
    values.push(
      runId,
      item.position,
      item.postUri,
      item.postCreatedAt,
      item.authorDid,
      canonicalJson(item.componentDecomposition),
      [...item.candidateSources],
      canonicalJson(item.diversityContext),
      item.baseScore,
      item.finalScore
    );
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, `
      + `$${offset + 6}::jsonb, $${offset + 7}::text[], $${offset + 8}::jsonb, `
      + `$${offset + 9}, $${offset + 10})`
    );
  }

  await client.query(
    `INSERT INTO ranking_run_items (
       run_id, position, post_uri, post_created_at, author_did,
       component_decomposition, candidate_sources, diversity_context,
       base_score, final_score
     ) VALUES ${placeholders.join(', ')}`,
    values
  );
}

export async function validateRankingRun(
  client: PoolClient,
  input: ValidateRankingRunInput
): Promise<void> {
  validateRankingReceipt(input.receipt);
  if (input.receipt.runId !== input.runId) {
    throw new Error(`Receipt run ${input.receipt.runId} does not match ${input.runId}`);
  }
  const current = await lockRankingRun(client, input.runId);
  if (current.state !== 'running') {
    throw new Error(`Ranking run must be running before validation, got ${current.state}`);
  }
  assertReceiptMatchesRun(input.receipt, current);

  const inputResult = await client.query<{ checksum: string; candidate_count: number }>(
    `SELECT checksum::text, candidate_count
       FROM ranking_run_inputs
      WHERE run_id = $1`,
    [input.runId]
  );
  const storedInput = inputResult.rows[0];
  if (!storedInput) {
    throw new Error(`Ranking run ${input.runId} has no replay input`);
  }
  if (storedInput.checksum !== input.receipt.inputChecksum) {
    throw new Error(`Ranking run ${input.runId} receipt does not match stored input checksum`);
  }
  if (storedInput.candidate_count !== input.candidateCount) {
    throw new Error(
      `Ranking run ${input.runId} candidate count mismatch: stored ${storedInput.candidate_count}, supplied ${input.candidateCount}`
    );
  }

  const itemResult = await client.query<RankingItemIdentityRow>(
    `SELECT position, post_uri, post_created_at
       FROM ranking_run_items
      WHERE run_id = $1
      ORDER BY position ASC`,
    [input.runId]
  );
  const itemCount = itemResult.rows.length;
  if (itemCount !== input.receipt.itemCount) {
    throw new Error(
      `Ranking run ${input.runId} item count mismatch: stored ${itemCount}, receipt ${input.receipt.itemCount}`
    );
  }
  const storedItemOrderChecksum = hashCanonicalJson(itemResult.rows.map((item) => [
    item.position,
    item.post_uri,
    toIsoTimestamp(item.post_created_at, `ranking item ${item.position} post_created_at`),
  ]));
  if (storedItemOrderChecksum !== input.receipt.itemOrderChecksum) {
    throw new Error(
      `Ranking run ${input.runId} item order checksum does not match stored slate`
    );
  }

  await client.query(
    `UPDATE ranking_runs
        SET state = 'validated',
            candidate_count = $2,
            selected_count = $3,
            exclusion_count = $4,
            timings = $5::jsonb,
            metrics = $6::jsonb,
            input_checksum = $7,
            receipt_checksum = $8,
            receipt = $9::jsonb
      WHERE id = $1`,
    [
      input.runId,
      input.candidateCount,
      input.receipt.itemCount,
      input.exclusionCount,
      canonicalJson(input.timings),
      canonicalJson(input.metrics),
      input.receipt.inputChecksum,
      input.receipt.receiptChecksum,
      canonicalJson(input.receipt),
    ]
  );
}

export async function prepareRankingRunPublication(
  client: PoolClient,
  runId: string,
  requestedBy: string,
  replacementNotBefore: string
): Promise<PreparePublicationResult> {
  assertIsoTimestamp(replacementNotBefore, 'replacementNotBefore');
  const current = await lockRankingRun(client, runId);
  if (current.state !== 'validated') {
    throw new Error(`Ranking run must be validated before publication, got ${current.state}`);
  }
  const policyResult = await client.query<{ policy_hash: string }>(
    `SELECT policy_hash::text
       FROM governance_policy_versions
      WHERE community_id = $1
        AND effective_at <= NOW()
      ORDER BY effective_at DESC, created_at DESC
      LIMIT 1
      FOR SHARE`,
    [current.community_id]
  );
  const currentPolicyHash = policyResult.rows[0]?.policy_hash;
  if (!currentPolicyHash) {
    throw new Error(`No effective policy exists for community ${current.community_id}`);
  }
  if (currentPolicyHash === current.policy_hash) {
    return { publishable: true, currentPolicyHash, replacementRequestId: null };
  }

  await client.query(
    `UPDATE ranking_runs
        SET state = 'superseded'
      WHERE id = $1`,
    [runId]
  );
  await client.query(
    `INSERT INTO ranking_run_events (
       run_id, event_type, previous_state, next_state, details
     ) VALUES ($1, 'stale_policy_detected', 'validated', 'superseded', $2::jsonb)`,
    [runId, canonicalJson({ supersededByPolicyHash: currentPolicyHash })]
  );
  const replacement = await enqueueRankingRunRequest(client, {
    idempotencyKey: `replacement:${runId}:${currentPolicyHash}`,
    communityId: current.community_id,
    requestKind: 'replacement',
    requestedBy,
    notBefore: replacementNotBefore,
  });
  return {
    publishable: false,
    currentPolicyHash,
    replacementRequestId: replacement.id,
  };
}

export async function reconcilePublishedRankingRun(
  client: PoolClient,
  metadata: RankingPublicationMetadata
): Promise<{ repaired: boolean }> {
  assertSha256(metadata.policyHash, 'publication policyHash');
  assertSha256(metadata.configurationHash, 'publication configurationHash');
  assertSha256(metadata.receiptChecksum, 'publication receiptChecksum');
  const current = await lockRankingRun(client, metadata.runId);
  assertPublicationMetadataMatchesRun(metadata, current);

  if (current.state === 'published') {
    if (current.snapshot_id !== metadata.snapshotId) {
      throw new Error(
        `Published run ${metadata.runId} snapshot mismatch: DB ${current.snapshot_id}, Redis ${metadata.snapshotId}`
      );
    }
    return { repaired: false };
  }
  if (current.state !== 'validated') {
    throw new Error(
      `Cannot reconcile Redis publication for run ${metadata.runId} from state ${current.state}`
    );
  }

  await client.query(
    `UPDATE ranking_runs
        SET state = 'published',
            snapshot_id = $2
      WHERE id = $1`,
    [metadata.runId, metadata.snapshotId]
  );
  await client.query(
    `INSERT INTO ranking_run_events (
       run_id, event_type, previous_state, next_state, details
     ) VALUES ($1, 'redis_publication_reconciled', 'validated', 'published', $2::jsonb)`,
    [metadata.runId, canonicalJson({ snapshotId: metadata.snapshotId })]
  );
  return { repaired: true };
}

export async function enqueueRankingRunRequest(
  client: PoolClient,
  input: EnqueueRankingRequestInput
): Promise<{ id: string; created: boolean }> {
  assertIsoTimestamp(input.notBefore, 'notBefore');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ranking_run_requests (
       idempotency_key, community_id, request_kind, requested_by, not_before
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id::text`,
    [
      input.idempotencyKey,
      input.communityId,
      input.requestKind,
      input.requestedBy,
      input.notBefore,
    ]
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, created: true };
  }
  const existing = await client.query<{ id: string }>(
    `SELECT id::text
       FROM ranking_run_requests
      WHERE idempotency_key = $1`,
    [input.idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error(`Ranking request lost idempotent row for ${input.idempotencyKey}`);
  }
  return { id: row.id, created: false };
}

export async function loadRankingRunInput(
  client: PoolClient,
  runId: string
): Promise<CompressedRankingInput> {
  const result = await client.query<RankingInputRow>(
    `SELECT payload, checksum::text, candidate_count,
            uncompressed_bytes, compressed_bytes
       FROM ranking_run_inputs
      WHERE run_id = $1`,
    [runId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`No replay input exists for ranking run ${runId}`);
  }
  return {
    payload: row.payload,
    checksum: row.checksum,
    candidateCount: row.candidate_count,
    uncompressedBytes: Number(row.uncompressed_bytes),
    compressedBytes: Number(row.compressed_bytes),
  };
}

export async function cleanupExpiredRankingData(
  client: PoolClient,
  asOf: string
): Promise<CleanupRankingDataResult> {
  assertIsoTimestamp(asOf, 'cleanup asOf');
  const inputs = await client.query<{ run_id: string }>(
    `DELETE FROM ranking_run_inputs
      WHERE retained_until <= $1
      RETURNING run_id::text`,
    [asOf]
  );
  const runs = await client.query<{ id: string }>(
    `DELETE FROM ranking_runs
      WHERE retain_until <= $1
        AND state IN ('published', 'failed', 'superseded', 'rejected')
      RETURNING id::text`,
    [asOf]
  );
  return {
    deletedInputs: inputs.rows.length,
    deletedRuns: runs.rows.length,
  };
}

function validateInputEnvelope(value: unknown): asserts value is RankingRunInputEnvelope {
  if (!isRecord(value)) {
    throw new Error('Ranking input envelope must be an object');
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported ranking input schema version ${String(value.schemaVersion)}`);
  }
  const runId = requireNonEmptyString(value, 'runId');
  const communityId = requireNonEmptyString(value, 'communityId');
  const policyHash = requireNonEmptyString(value, 'policyHash');
  const configurationHash = requireNonEmptyString(value, 'configurationHash');
  const asOf = requireNonEmptyString(value, 'asOf');
  void runId;
  void communityId;
  assertSha256(policyHash, 'ranking input policyHash');
  assertSha256(configurationHash, 'ranking input configurationHash');
  assertIsoTimestamp(asOf, 'ranking input asOf');
  if (!Array.isArray(value.candidates) || value.candidates.some((candidate) => !isRecord(candidate))) {
    throw new Error('Ranking input candidates must be an array of objects');
  }
}

function validateRankedItems(items: readonly RankedSlateItem[]): void {
  if (items.length > 1000) {
    throw new Error(`Ranked slate cannot exceed 1000 items, got ${items.length}`);
  }
  const identities = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const expectedPosition = index + 1;
    if (item.position !== expectedPosition) {
      throw new Error(
        `Ranked slate positions must be consecutive: expected ${expectedPosition}, got ${item.position}`
      );
    }
    assertIsoTimestamp(item.postCreatedAt, `item ${item.position} postCreatedAt`);
    if (item.candidateSources.length === 0) {
      throw new Error(`Ranked slate item ${item.position} has no candidate source`);
    }
    if (!Number.isFinite(item.baseScore) || !Number.isFinite(item.finalScore)) {
      throw new Error(`Ranked slate item ${item.position} has a non-finite score`);
    }
    const identity = `${item.postUri}\u0000${item.postCreatedAt}`;
    if (identities.has(identity)) {
      throw new Error(`Ranked slate contains duplicate post identity ${item.postUri}`);
    }
    identities.add(identity);
    canonicalJson(item.componentDecomposition);
    canonicalJson(item.diversityContext);
  }
}

async function lockRankingRun(client: PoolClient, runId: string): Promise<RankingRunRow> {
  const result = await client.query<RankingRunRow>(
    `SELECT id::text, community_id, policy_version_id::text, policy_hash::text,
            algorithm_version, configuration_hash::text, code_sha, as_of,
            state, selected_count, snapshot_id, receipt_checksum::text
       FROM ranking_runs
      WHERE id = $1
      FOR UPDATE`,
    [runId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Ranking run ${runId} does not exist`);
  }
  return row;
}

function assertReceiptMatchesRun(receipt: RankingReceipt, run: RankingRunRow): void {
  const mismatches: string[] = [];
  if (receipt.communityId !== run.community_id) mismatches.push('communityId');
  if (receipt.policyVersionId !== run.policy_version_id) mismatches.push('policyVersionId');
  if (receipt.policyHash !== run.policy_hash) mismatches.push('policyHash');
  if (receipt.algorithmVersion !== run.algorithm_version) mismatches.push('algorithmVersion');
  if (receipt.configurationHash !== run.configuration_hash) mismatches.push('configurationHash');
  if (receipt.codeSha !== run.code_sha) mismatches.push('codeSha');
  if (receipt.asOf !== toIsoTimestamp(run.as_of, 'ranking run as_of')) mismatches.push('asOf');
  if (mismatches.length > 0) {
    throw new Error(`Ranking receipt does not match run identity: ${mismatches.join(', ')}`);
  }
}

function assertInputEnvelopeMatchesRun(
  envelope: RankingRunInputEnvelope,
  run: RankingRunRow
): void {
  const mismatches: string[] = [];
  if (envelope.runId !== run.id) mismatches.push('runId');
  if (envelope.communityId !== run.community_id) mismatches.push('communityId');
  if (envelope.policyHash !== run.policy_hash) mismatches.push('policyHash');
  if (envelope.configurationHash !== run.configuration_hash) mismatches.push('configurationHash');
  if (toIsoTimestamp(envelope.asOf, 'ranking input asOf')
      !== toIsoTimestamp(run.as_of, 'ranking run as_of')) {
    mismatches.push('asOf');
  }
  if (mismatches.length > 0) {
    throw new Error(`Ranking input does not match run identity: ${mismatches.join(', ')}`);
  }
}

function assertPublicationMetadataMatchesRun(
  metadata: RankingPublicationMetadata,
  run: RankingRunRow
): void {
  const mismatches: string[] = [];
  if (metadata.policyHash !== run.policy_hash) mismatches.push('policyHash');
  if (metadata.configurationHash !== run.configuration_hash) mismatches.push('configurationHash');
  if (metadata.itemCount !== run.selected_count) mismatches.push('itemCount');
  if (metadata.receiptChecksum !== run.receipt_checksum) mismatches.push('receiptChecksum');
  if (mismatches.length > 0) {
    throw new Error(`Redis publication metadata does not match DB run: ${mismatches.join(', ')}`);
  }
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertIsoTimestamp(value: string, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
}

function toIsoTimestamp(value: Date | string, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonEmptyString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(`Ranking input ${key} must be a non-empty string`);
  }
  return candidate;
}

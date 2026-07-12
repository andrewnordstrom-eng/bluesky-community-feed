import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { GOVERNANCE_WEIGHT_KEYS } from '../config/votable-params.js';
import type {
  GovernancePolicyDocument,
  JsonObject,
  JsonValue,
  PolicyBundle,
  PolicyProvenanceReference,
} from '../shared/ranking-contracts.js';

const POLICY_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface ActiveEpochRow {
  id: number;
  recency_weight: number | string;
  engagement_weight: number | string;
  bridging_weight: number | string;
  source_diversity_weight: number | string;
  relevance_weight: number | string;
  topic_weights: unknown;
  content_rules: unknown;
  created_at: Date | string;
}

interface LongWeightRow {
  component_key: string;
  weight: number | string;
}

interface AuditRow {
  id: number;
  action: string;
  details: unknown;
  created_at: Date | string;
}

interface PolicyVersionRow {
  id: string;
  policy_hash: string;
  reconciliation_status: PolicyBundle['reconciliationStatus'];
  created_at: Date | string;
}

export interface PolicyMaterializationInput {
  communityId: string;
  algorithmVersion: string;
  effectiveAt: string;
  provenanceReferences: readonly PolicyProvenanceReference[];
}

export interface PolicyMaterializationResult {
  bundle: PolicyBundle;
  created: boolean;
  evidenceHash: string;
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new WeakSet<object>());
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function computePolicyHash(document: GovernancePolicyDocument): string {
  return hashCanonicalJson(document);
}

export function assertSha256(value: string, label: string): void {
  if (!POLICY_HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

export async function materializeActivePolicyVersion(
  client: PoolClient,
  input: PolicyMaterializationInput
): Promise<PolicyMaterializationResult> {
  assertNonEmpty(input.communityId, 'communityId');
  assertNonEmpty(input.algorithmVersion, 'algorithmVersion');
  assertIsoTimestamp(input.effectiveAt, 'effectiveAt');

  const epochResult = await client.query<ActiveEpochRow>(
    `SELECT id, recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight, topic_weights,
            content_rules, created_at
       FROM governance_epochs
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
      FOR SHARE`
  );
  const epoch = epochResult.rows[0];
  if (!epoch) {
    throw new Error('Cannot materialize policy: no active governance epoch exists');
  }

  const longWeightResult = await client.query<LongWeightRow>(
    `SELECT component_key, weight
       FROM governance_epoch_weights
      WHERE epoch_id = $1
      ORDER BY component_key`,
    [epoch.id]
  );
  if (longWeightResult.rows.length === 0) {
    throw new Error(`Cannot materialize policy for epoch ${epoch.id}: serving weight rows are missing`);
  }

  const auditResult = await client.query<AuditRow>(
    `SELECT id, action, details, created_at
       FROM governance_audit_log
      WHERE epoch_id = $1
      ORDER BY id`,
    [epoch.id]
  );
  const policyAuditRows = auditResult.rows.filter(isPolicyAuditRow);

  const servingWeights = normalizeNumericRecord(
    Object.fromEntries(longWeightResult.rows.map((row) => [row.component_key, row.weight])),
    `serving weights for epoch ${epoch.id}`
  );
  assertCompleteServingWeights(servingWeights, epoch.id);
  const wideWeights = normalizeNumericRecord(
    {
      recency: epoch.recency_weight,
      engagement: epoch.engagement_weight,
      bridging: epoch.bridging_weight,
      sourceDiversity: epoch.source_diversity_weight,
      relevance: epoch.relevance_weight,
    },
    `wide weights for epoch ${epoch.id}`
  );
  const auditWeights = latestAuditWeights(policyAuditRows, epoch.id);
  const reconciliationStatus = determineReconciliationStatus(
    servingWeights,
    wideWeights,
    auditWeights
  );

  const auditReferences: PolicyProvenanceReference[] = policyAuditRows.map((row) => ({
    kind: 'governance_audit_log',
    reference: String(row.id),
    observedAt: toIsoTimestamp(row.created_at, `audit log ${row.id} created_at`),
  }));
  const provenanceReferences = canonicalClone([
    ...input.provenanceReferences,
    ...auditReferences,
    {
      kind: 'governance_epoch',
      reference: String(epoch.id),
      observedAt: toIsoTimestamp(epoch.created_at, `epoch ${epoch.id} created_at`),
    },
  ]) as unknown as PolicyProvenanceReference[];

  const document: GovernancePolicyDocument = {
    communityId: input.communityId,
    epochId: epoch.id,
    algorithmVersion: input.algorithmVersion,
    weights: servingWeights,
    topicWeights: normalizeNumericRecord(epoch.topic_weights ?? {}, `topic weights for epoch ${epoch.id}`),
    contentRules: normalizeJsonObject(epoch.content_rules ?? {}, `content rules for epoch ${epoch.id}`),
    effectiveAt: input.effectiveAt,
    provenanceReferences,
  };
  const policyHash = computePolicyHash(document);

  const inserted = await client.query<PolicyVersionRow>(
    `INSERT INTO governance_policy_versions (
       community_id, epoch_id, algorithm_version, weights, topic_weights,
       content_rules, effective_at, provenance_references, policy_hash,
       reconciliation_status
     ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)
     ON CONFLICT (community_id, epoch_id, algorithm_version, policy_hash) DO NOTHING
     RETURNING id::text, policy_hash::text, reconciliation_status, created_at`,
    [
      document.communityId,
      document.epochId,
      document.algorithmVersion,
      canonicalJson(document.weights),
      canonicalJson(document.topicWeights),
      canonicalJson(document.contentRules),
      document.effectiveAt,
      canonicalJson(document.provenanceReferences),
      policyHash,
      reconciliationStatus,
    ]
  );

  const created = inserted.rows.length === 1;
  const policyRow = inserted.rows[0] ?? await loadExistingPolicyVersion(
    client,
    document,
    policyHash
  );

  const evidence = {
    communityId: document.communityId,
    epochId: document.epochId,
    policyHash,
    servingWeights,
    wideWeights,
    auditWeights,
    auditLogIds: policyAuditRows.map((row) => row.id),
    reconciliationStatus,
  };
  const evidenceHash = hashCanonicalJson(evidence);

  await client.query(
    `INSERT INTO governance_policy_reconciliation_events (
       policy_version_id, community_id, epoch_id, reconciliation_status,
       serving_weights, wide_weights, audit_weights, audit_log_ids,
       evidence_hash, details
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::bigint[], $9, $10::jsonb)
     ON CONFLICT (policy_version_id, evidence_hash) DO NOTHING`,
    [
      policyRow.id,
      document.communityId,
      document.epochId,
      reconciliationStatus,
      canonicalJson(servingWeights),
      canonicalJson(wideWeights),
      auditWeights === null ? null : canonicalJson(auditWeights),
      policyAuditRows.map((row) => row.id),
      evidenceHash,
      canonicalJson({ policyHash }),
    ]
  );

  return {
    bundle: {
      ...document,
      policyVersionId: policyRow.id,
      policyHash: policyRow.policy_hash,
      reconciliationStatus: policyRow.reconciliation_status,
      createdAt: toIsoTimestamp(policyRow.created_at, 'policy version created_at'),
    },
    created,
    evidenceHash,
  };
}

async function loadExistingPolicyVersion(
  client: PoolClient,
  document: GovernancePolicyDocument,
  policyHash: string
): Promise<PolicyVersionRow> {
  const existing = await client.query<PolicyVersionRow>(
    `SELECT id::text, policy_hash::text, reconciliation_status, created_at
       FROM governance_policy_versions
      WHERE community_id = $1
        AND epoch_id = $2
        AND algorithm_version = $3
        AND policy_hash = $4`,
    [document.communityId, document.epochId, document.algorithmVersion, policyHash]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error(`Policy materialization lost idempotent row for hash ${policyHash}`);
  }
  return row;
}

function determineReconciliationStatus(
  servingWeights: Readonly<Record<string, number>>,
  wideWeights: Readonly<Record<string, number>>,
  auditWeights: Readonly<Record<string, number>> | null
): PolicyBundle['reconciliationStatus'] {
  if (canonicalJson(servingWeights) !== canonicalJson(wideWeights)) {
    return 'conflict_preserved';
  }
  if (auditWeights === null) {
    return 'incomplete_evidence';
  }
  return canonicalJson(servingWeights) === canonicalJson(auditWeights)
    ? 'match'
    : 'conflict_preserved';
}

function latestAuditWeights(
  rows: readonly AuditRow[],
  epochId: number
): Readonly<Record<string, number>> | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!isRecord(row.details)) {
      continue;
    }
    const candidate = row.details.new_weights;
    if (candidate === undefined || candidate === null) {
      continue;
    }
    return normalizeNumericRecord(candidate, `audit weights for epoch ${epochId}, event ${row.id}`);
  }
  return null;
}

function isPolicyAuditRow(row: AuditRow): boolean {
  if (!isRecord(row.details)) {
    return false;
  }
  return [
    'new_weights',
    'new_content_rules',
    'content_rules',
    'new_topic_weights',
    'topic_weights',
  ].some((key) => Object.hasOwn(row.details as object, key));
}

function normalizeNumericRecord(value: unknown, label: string): Readonly<Record<string, number>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const normalized: Record<string, number> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate !== 'number'
      && (typeof candidate !== 'string' || candidate.trim().length === 0)
    ) {
      throw new Error(`${label}.${key} must be a number`);
    }
    const numeric = typeof candidate === 'number' ? candidate : Number(candidate);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${label}.${key} must be a finite number`);
    }
    normalized[key] = Object.is(numeric, -0) ? 0 : numeric;
  }
  return canonicalClone(normalized) as Record<string, number>;
}

function assertCompleteServingWeights(
  servingWeights: Readonly<Record<string, number>>,
  epochId: number
): void {
  const expected = [...GOVERNANCE_WEIGHT_KEYS].sort();
  const actual = Object.keys(servingWeights).sort();
  const missing = expected.filter((key) => !Object.hasOwn(servingWeights, key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Cannot materialize policy for epoch ${epochId}: serving weight keys do not match registry`
      + ` (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`
    );
  }
  const total = Object.values(servingWeights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      `Cannot materialize policy for epoch ${epochId}: serving weights total ${total}, expected 1`
    );
  }
}

function normalizeJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return canonicalClone(value) as JsonObject;
}

function canonicalClone(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical JSON cannot contain non-finite numbers');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON cannot contain ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error('Canonical JSON cannot contain cyclic references');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`;
    }
    if (!isRecord(value)) {
      throw new Error('Canonical JSON only accepts plain objects');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('Canonical JSON cannot contain symbol keys');
    }
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const child = value[key];
      if (child === undefined) {
        throw new Error(`Canonical JSON cannot contain undefined at key ${key}`);
      }
      return `${JSON.stringify(key)}:${canonicalize(child, ancestors)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type RankingRunState =
  | 'requested'
  | 'running'
  | 'validated'
  | 'published'
  | 'failed'
  | 'superseded'
  | 'rejected';

export const CANDIDATE_SOURCES = [
  'newest',
  'engagement',
  'policy_relevance',
  'previous_snapshot',
  'preliminary_fill',
] as const;

export type CandidateSource = typeof CANDIDATE_SOURCES[number];

export interface PolicyProvenanceReference {
  kind: string;
  reference: string;
  observedAt: string;
}

export interface GovernancePolicyDocument {
  communityId: string;
  epochId: number;
  algorithmVersion: string;
  weights: Readonly<Record<string, number>>;
  topicWeights: Readonly<Record<string, number>>;
  contentRules: JsonObject;
  effectiveAt: string;
  provenanceReferences: readonly PolicyProvenanceReference[];
}

export interface PolicyBundle extends GovernancePolicyDocument {
  policyVersionId: string;
  policyHash: string;
  reconciliationStatus: 'match' | 'incomplete_evidence' | 'conflict_preserved';
  createdAt: string;
}

export interface RankingRunContext {
  runId: string;
  communityId: string;
  asOf: string;
  policy: PolicyBundle;
  algorithmVersion: string;
  configurationHash: string;
  codeSha: string;
}

export type EvidenceState = 'observed' | 'insufficient';

export interface ComponentEvidence {
  raw: number;
  weight: number;
  weighted: number;
  evidenceState: EvidenceState;
}

export interface RankingReceipt {
  schemaVersion: 1;
  runId: string;
  communityId: string;
  policyVersionId: string;
  policyHash: string;
  algorithmVersion: string;
  configurationHash: string;
  codeSha: string;
  asOf: string;
  itemCount: number;
  inputChecksum: string;
  itemOrderChecksum: string;
  receiptChecksum: string;
}

export interface RankedSlateItem {
  position: number;
  postUri: string;
  postCreatedAt: string;
  authorDid: string;
  componentDecomposition: JsonObject;
  candidateSources: readonly CandidateSource[];
  diversityContext: JsonObject;
  baseScore: number;
  finalScore: number;
}

export interface RankingRunInputEnvelope {
  schemaVersion: 1;
  runId: string;
  communityId: string;
  policyHash: string;
  configurationHash: string;
  asOf: string;
  /** Required for v2 exact replay; optional only for retained v1 contract inputs. */
  sourceDiversityWeight?: number;
  candidates: readonly JsonObject[];
}

export interface RankingPublicationMetadata {
  runId: string;
  policyHash: string;
  configurationHash: string;
  itemCount: number;
  snapshotId: string;
  receiptChecksum: string;
}

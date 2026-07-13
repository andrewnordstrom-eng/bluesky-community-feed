import type { DemoFetchFunction } from './appview.js';
import type { PostScoreRecord } from '../scoring/score-reader.js';
import { rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export const COMMUNITY_GOV_SNAPSHOT_GATE = {
  minimumEligiblePosts: 40,
  minimumDisplayablePosts: 12,
  minimumEnglishTaggedShare: 0.8,
  maximumTopAuthorConcentration: 0.1,
  minimumRichMediaShare: 0.2,
} as const;

const SnapshotCaptureReportSchema = z.object({
  schemaVersion: z.literal('2026-07-11.community-gov-snapshot.v3'),
  artifactKind: z.literal('live_production_snapshot_capture'),
  corpusSource: z.literal('production_feed_snapshot'),
  approvable: z.boolean(),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime({ offset: true }),
  productionEpochId: z.number().int().positive(),
  sourceRunId: z.string().trim().min(1),
  sourceCount: z.number().int().positive(),
  eligibleCount: z.number().int().nonnegative(),
  displayableCount: z.number().int().nonnegative(),
  scoreCompletenessRate: z.number().finite().min(0).max(1),
  uniqueAuthorCount: z.number().int().nonnegative(),
  topAuthorConcentration: z.number().finite().min(0).max(1),
  englishTaggedShare: z.number().finite().min(0).max(1),
  richMediaShare: z.number().finite().min(0).max(1),
  languageDistribution: z.record(z.string(), z.number().int().nonnegative()),
  mediaDistribution: z.record(z.string(), z.number().int().nonnegative()),
  gateFailures: z.array(z.string().trim().min(1)),
  safetyChecklist: z.object({
    appViewVisibilityApplied: z.literal(true),
    nestedLabelsApplied: z.literal(true),
    reviewerLanguageGateApplied: z.literal(true),
    sourceLinksValidated: z.boolean(),
    copiedPostTextInManifest: z.literal(false),
    manualReviewComplete: z.literal(false),
  }).strict(),
  warnings: z.array(z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    severity: z.enum(['info', 'warning', 'degraded']),
  }).strict()),
}).strict();

export type SnapshotCaptureReport = z.infer<typeof SnapshotCaptureReportSchema>;

export interface SnapshotCaptureArtifactPaths {
  manifest: string;
  report: string;
  reviewSheet: string;
}

export function snapshotApprovalWriteFlag(force: boolean): 'w' | 'wx' {
  return force ? 'w' : 'wx';
}

export async function clearSnapshotCaptureArtifacts(paths: SnapshotCaptureArtifactPaths): Promise<void> {
  await Promise.all([
    rm(paths.manifest, { force: true }),
    rm(paths.report, { force: true }),
    rm(paths.reviewSheet, { force: true }),
  ]);
}

export async function writeSnapshotCaptureArtifacts(options: {
  paths: SnapshotCaptureArtifactPaths;
  report: SnapshotCaptureReport;
  manifestJson: string;
  reviewSheetHtml: string;
}): Promise<void> {
  await clearSnapshotCaptureArtifacts(options.paths);
  await writeFile(options.paths.report, `${JSON.stringify(options.report, null, 2)}\n`, 'utf8');
  if (!options.report.approvable) return;
  await Promise.all([
    writeFile(options.paths.manifest, options.manifestJson, 'utf8'),
    writeFile(options.paths.reviewSheet, options.reviewSheetHtml, 'utf8'),
  ]);
}

export function parseSnapshotCaptureReport(input: unknown): SnapshotCaptureReport {
  const parsed = SnapshotCaptureReportSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Corgi Commons capture report is invalid: ${detail}`);
  }
  return parsed.data;
}

export function captureReportApprovalFailures(
  report: SnapshotCaptureReport,
  expectedManifestDigest: string
): string[] {
  const failures = [...report.gateFailures];
  if (report.manifestDigest !== expectedManifestDigest) {
    failures.push(
      `capture report manifest digest ${report.manifestDigest} does not match ${expectedManifestDigest}`
    );
  }
  if (!report.approvable) failures.push('capture report is marked non-approvable');
  if (report.scoreCompletenessRate !== 1) {
    failures.push(`score decomposition completeness ${report.scoreCompletenessRate} < 1`);
  }
  if (report.eligibleCount < COMMUNITY_GOV_SNAPSHOT_GATE.minimumEligiblePosts) {
    failures.push(
      `eligible posts ${report.eligibleCount} < ${COMMUNITY_GOV_SNAPSHOT_GATE.minimumEligiblePosts}`
    );
  }
  if (report.displayableCount < COMMUNITY_GOV_SNAPSHOT_GATE.minimumDisplayablePosts) {
    failures.push(
      `displayable posts ${report.displayableCount} < ${COMMUNITY_GOV_SNAPSHOT_GATE.minimumDisplayablePosts}`
    );
  }
  if (report.englishTaggedShare < COMMUNITY_GOV_SNAPSHOT_GATE.minimumEnglishTaggedShare) {
    failures.push(
      `English-tagged share ${report.englishTaggedShare} < ${COMMUNITY_GOV_SNAPSHOT_GATE.minimumEnglishTaggedShare}`
    );
  }
  if (report.topAuthorConcentration > COMMUNITY_GOV_SNAPSHOT_GATE.maximumTopAuthorConcentration) {
    failures.push(
      `top-author concentration ${report.topAuthorConcentration} > ${COMMUNITY_GOV_SNAPSHOT_GATE.maximumTopAuthorConcentration}`
    );
  }
  if (report.richMediaShare < COMMUNITY_GOV_SNAPSHOT_GATE.minimumRichMediaShare) {
    failures.push(
      `rich-media share ${report.richMediaShare} < ${COMMUNITY_GOV_SNAPSHOT_GATE.minimumRichMediaShare}`
    );
  }
  if (!report.safetyChecklist.sourceLinksValidated) {
    failures.push('one or more public source links failed validation');
  }
  return [...new Set(failures)];
}

export function createBoundedDemoFetch(timeoutMs: number): DemoFetchFunction {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Demo snapshot AppView timeout must be positive and finite: ${timeoutMs}`);
  }
  return async (input, init) => {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(init.signal.reason);
    if (init.signal.aborted) {
      forwardAbort();
    } else {
      init.signal.addEventListener('abort', forwardAbort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error(`AppView request exceeded ${timeoutMs} ms`)), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      init.signal.removeEventListener('abort', forwardAbort);
    }
  };
}

export function scoreCompletenessRate(
  scores: ReadonlyArray<PostScoreRecord | null>,
  expectedCount: number
): number {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`Demo snapshot score denominator must be a non-negative integer: ${expectedCount}`);
  }
  const complete = scores.filter(hasCompleteScoreDecomposition).length;
  if (complete > expectedCount) {
    throw new Error(`Demo snapshot completeness numerator ${complete} exceeds denominator ${expectedCount}`);
  }
  if (expectedCount === 0) return 0;
  return Number((complete / expectedCount).toFixed(6));
}

export function canonicalizeFrozenEmbedUrl(value: string | null): string | null {
  if (value === null) return null;
  const url = new URL(value);
  if (url.protocol === 'http:') return null;
  if (url.protocol !== 'https:') {
    throw new Error(`Demo snapshot embed URL must use HTTPS: ${url.protocol}`);
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function hasCompleteScoreDecomposition(score: PostScoreRecord | null): score is PostScoreRecord {
  if (!score) return false;
  return ['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'].every((key) => {
    const component = score.components[key];
    return component !== undefined
      && Number.isFinite(component.raw)
      && Number.isFinite(component.weight)
      && Number.isFinite(component.weighted);
  });
}

import type {
  ComponentEvidence,
  JsonObject,
  RankedSlateItem,
} from '../shared/ranking-contracts.js';
import type { SlateReranker } from './component.interface.js';
import type { RankingV2FeatureVector } from './ranking-v2-features.js';

export interface DiversitySelectionContext {
  authorCountBeforeSelection: number;
  raw: number;
  weight: number;
  weighted: number;
}

export const RANKING_V2_SLATE_LIMIT = 1000;

/** Apply the governed source-diversity objective during deterministic slate selection. */
export class SourceDiversitySlateReranker implements SlateReranker<RankingV2FeatureVector, RankedSlateItem> {
  readonly key = 'sourceDiversity';

  constructor(private readonly weight: number) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new RangeError(`sourceDiversity weight must be in [0, 1], got ${weight}`);
    }
  }

  rerank(
    items: readonly RankingV2FeatureVector[],
    limit: number
  ): readonly RankedSlateItem[] {
    if (!Number.isInteger(limit) || limit < 0 || limit > RANKING_V2_SLATE_LIMIT) {
      throw new RangeError(
        `slate limit must be an integer in [0, ${RANKING_V2_SLATE_LIMIT}], got ${limit}`
      );
    }
    const remaining = [...items];
    const authorCounts = new Map<string, number>();
    const selected: RankedSlateItem[] = [];

    while (selected.length < limit && remaining.length > 0) {
      let bestIndex = 0;
      let bestContext = diversityContext(remaining[0], authorCounts, this.weight);
      for (let index = 1; index < remaining.length; index += 1) {
        const context = diversityContext(remaining[index], authorCounts, this.weight);
        if (compareSelection(remaining[index], context, remaining[bestIndex], bestContext) < 0) {
          bestIndex = index;
          bestContext = context;
        }
      }

      const [best] = remaining.splice(bestIndex, 1);
      const authorDid = best.candidate.post.authorDid;
      authorCounts.set(authorDid, bestContext.authorCountBeforeSelection + 1);
      selected.push(toRankedSlateItem(best, bestContext, selected.length + 1));
    }
    return selected;
  }
}

export const SLATE_RERANKERS: Readonly<Record<string, typeof SourceDiversitySlateReranker>> = {
  sourceDiversity: SourceDiversitySlateReranker,
};

/** Return the governed diversity value for an author's next selected post. */
export function diversityRaw(authorCountBeforeSelection: number): number {
  if (!Number.isInteger(authorCountBeforeSelection) || authorCountBeforeSelection < 0) {
    throw new RangeError(`author count must be a non-negative integer, got ${authorCountBeforeSelection}`);
  }
  if (authorCountBeforeSelection === 0) return 1;
  if (authorCountBeforeSelection === 1) return 0.7;
  if (authorCountBeforeSelection === 2) return 0.5;
  return 0.3;
}

function diversityContext(
  item: RankingV2FeatureVector,
  authorCounts: ReadonlyMap<string, number>,
  weight: number
): DiversitySelectionContext {
  const authorCountBeforeSelection = authorCounts.get(item.candidate.post.authorDid) ?? 0;
  const raw = diversityRaw(authorCountBeforeSelection);
  return { authorCountBeforeSelection, raw, weight, weighted: raw * weight };
}

function compareSelection(
  left: RankingV2FeatureVector,
  leftContext: DiversitySelectionContext,
  right: RankingV2FeatureVector,
  rightContext: DiversitySelectionContext
): number {
  const leftUtility = left.baseScore + leftContext.weighted;
  const rightUtility = right.baseScore + rightContext.weighted;
  return rightUtility - leftUtility
    || right.baseScore - left.baseScore
    || right.candidate.post.createdAt.getTime() - left.candidate.post.createdAt.getTime()
    || compareStrings(left.candidate.post.uri, right.candidate.post.uri);
}

function toRankedSlateItem(
  item: RankingV2FeatureVector,
  diversity: DiversitySelectionContext,
  position: number
): RankedSlateItem {
  const scoreComponents: Record<string, ComponentEvidence> = {};
  for (const key of Object.keys(item.raw).sort()) {
    scoreComponents[key] = {
      raw: item.raw[key],
      weight: item.weights[key],
      weighted: item.weighted[key],
      evidenceState: key === 'bridging'
        ? item.evidence.bridging.evidenceState
        : 'observed',
    };
  }
  scoreComponents.sourceDiversity = {
    raw: diversity.raw,
    weight: diversity.weight,
    weighted: diversity.weighted,
    evidenceState: 'observed',
  };
  const componentDecomposition: JsonObject = {
    ...scoreComponents,
    evidence: item.evidence,
  };

  return {
    position,
    postUri: item.candidate.post.uri,
    postCreatedAt: item.candidate.post.createdAt.toISOString(),
    authorDid: item.candidate.post.authorDid,
    componentDecomposition,
    candidateSources: item.candidate.candidateSources,
    diversityContext: {
      authorCountBeforeSelection: diversity.authorCountBeforeSelection,
      raw: diversity.raw,
      weightedContribution: diversity.weighted,
    },
    baseScore: item.baseScore,
    finalScore: item.baseScore + diversity.weighted,
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

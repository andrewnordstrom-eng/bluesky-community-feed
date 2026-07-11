import {
  SHADOW_DEMO_INTERNAL_SIGNAL_KEYS,
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoInternalSignalKey,
  type ShadowDemoInternalWeights,
  type ShadowDemoRawScores,
  type ShadowDemoSignalKey,
  type ShadowDemoVoteSummary,
  type ShadowDemoTopicIntent,
  type ShadowDemoTopicRelevanceFormula,
  type ShadowDemoWeights,
} from './types.js';
import { aggregateRowsWithTrimmedMean } from '../governance/aggregation-math.js';
import { scoreTopicVectorRelevance } from '../scoring/components/relevance.js';
import { aggregateShadowTopicIntents } from './topic-intent.js';

const SUM_TOLERANCE = 0.000001;
const DEFAULT_TOPIC_WEIGHT = 0.2;
const TOPIC_CONFIDENCE_THRESHOLD = 0.5;

const INTERNAL_TO_WIRE: Record<ShadowDemoInternalSignalKey, ShadowDemoSignalKey> = {
  recency: 'recency',
  engagement: 'engagement',
  bridging: 'bridging',
  sourceDiversity: 'source_diversity',
  relevance: 'relevance',
};

const WIRE_TO_INTERNAL: Record<ShadowDemoSignalKey, ShadowDemoInternalSignalKey> = {
  recency: 'recency',
  engagement: 'engagement',
  bridging: 'bridging',
  source_diversity: 'sourceDiversity',
  relevance: 'relevance',
};

export function validateShadowWeights(value: unknown): ShadowDemoWeights {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Shadow demo weights must be an object with five signal weights');
  }

  const candidate = value as Record<string, unknown>;
  const weights = {} as ShadowDemoWeights;
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const weight = candidate[key];
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw new Error(`Shadow demo weight ${key} must be a finite number`);
    }
    if (weight < 0) {
      throw new Error(`Shadow demo weight ${key} must be non-negative`);
    }
    weights[key] = weight;
  }

  const sum = sumWeights(weights);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error(`Shadow demo weights must sum to 1.0; received ${sum.toFixed(6)}`);
  }

  return weights;
}

export function normalizeShadowWeights(value: ShadowDemoWeights): ShadowDemoWeights {
  const sum = sumWeights(value);
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error(`Shadow demo weights cannot be normalized from sum ${String(sum)}`);
  }

  const normalized = {} as ShadowDemoWeights;
  let running = 0;
  for (const key of SHADOW_DEMO_SIGNAL_KEYS.slice(0, SHADOW_DEMO_SIGNAL_KEYS.length - 1)) {
    const nextValue = roundScore(value[key] / sum);
    normalized[key] = nextValue;
    running += nextValue;
  }

  const lastKey = SHADOW_DEMO_SIGNAL_KEYS[SHADOW_DEMO_SIGNAL_KEYS.length - 1];
  const remainder = roundScore(1 - running);
  normalized[lastKey] = Math.max(0, remainder);
  if (remainder < 0) {
    const adjustableKey = SHADOW_DEMO_SIGNAL_KEYS
      .slice(0, SHADOW_DEMO_SIGNAL_KEYS.length - 1)
      .reduce((largest, key) => normalized[key] > normalized[largest] ? key : largest);
    normalized[adjustableKey] = roundScore(normalized[adjustableKey] + remainder);
  }
  return normalized;
}

export function aggregateShadowVotes(
  votes: ReadonlyArray<ShadowDemoWeights | { weights: ShadowDemoWeights; topicIntent: ShadowDemoTopicIntent }>
): ShadowDemoVoteSummary {
  if (votes.length === 0) {
    throw new Error('Cannot aggregate zero shadow demo votes');
  }

  const voteRecords = votes.map((vote) => (
    'weights' in vote
      ? vote
      : { weights: vote, topicIntent: { topicWeights: {} } }
  ));
  const aggregation = aggregateRowsWithTrimmedMean({
    rows: voteRecords.map((vote) => vote.weights),
    components: SHADOW_DEMO_SIGNAL_KEYS,
  });
  const averaged = aggregation.values as ShadowDemoWeights;

  return {
    aggregateMethod: 'trimmed_mean_no_trim_under_10',
    voteCount: votes.length,
    trimCount: aggregation.trimCount,
    weights: normalizeShadowWeights(averaged),
    topicIntent: aggregateShadowTopicIntents(voteRecords.map((vote) => vote.topicIntent)),
  };
}

export function scoreFromRawWeights(
  rawScores: ShadowDemoRawScores,
  weights: ShadowDemoWeights,
  topicVector: Record<string, number>,
  topicIntent: ShadowDemoTopicIntent
): {
  score: number;
  weightedComponents: Record<ShadowDemoSignalKey, number>;
  effectiveRawScores: ShadowDemoRawScores;
} {
  const effectiveRawScores: ShadowDemoRawScores = {
    ...rawScores,
    relevance: Object.keys(topicIntent.topicWeights).length > 0
      ? scoreTopicVectorRelevance(topicVector, topicIntent.topicWeights)
      : rawScores.relevance,
  };
  const weightedComponents = {} as Record<ShadowDemoSignalKey, number>;
  let score = 0;
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const contribution = roundScore(effectiveRawScores[key] * weights[key]);
    weightedComponents[key] = contribution;
    score += contribution;
  }

  return {
    score: roundScore(score),
    weightedComponents,
    effectiveRawScores,
  };
}

export function explainTopicRelevance(
  storedRelevance: number,
  topicVector: Record<string, number>,
  topicIntent: ShadowDemoTopicIntent
): ShadowDemoTopicRelevanceFormula {
  if (Object.keys(topicIntent.topicWeights).length === 0 || Object.keys(topicVector).length === 0) {
    return {
      formulaApplied: false,
      defaultTopicWeight: DEFAULT_TOPIC_WEIGHT,
      confidenceThreshold: TOPIC_CONFIDENCE_THRESHOLD,
      weightedSum: null,
      signalSum: null,
      baseRelevance: roundScore(storedRelevance),
      confidenceMultiplier: 1,
      effectiveRelevance: roundScore(storedRelevance),
      usedDefaultWeight: false,
      terms: [],
    };
  }

  const rawTerms = Object.entries(topicVector)
    .filter(([, postScore]) => Number.isFinite(postScore))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([topic, postScore]) => {
      const configuredWeight = topicIntent.topicWeights[topic];
      const hasConfiguredWeight = typeof configuredWeight === 'number' && Number.isFinite(configuredWeight);
      const communityWeight = hasConfiguredWeight ? configuredWeight : DEFAULT_TOPIC_WEIGHT;
      return {
        topic,
        postScore,
        communityWeight,
        weightedTerm: postScore * communityWeight,
        usedDefaultWeight: !hasConfiguredWeight,
      };
    });
  const weightedSum = rawTerms.reduce((sum, term) => sum + term.weightedTerm, 0);
  const signalSum = rawTerms.reduce((sum, term) => sum + term.postScore, 0);
  const terms = rawTerms.map((term) => ({
    ...term,
    postScore: roundScore(term.postScore),
    communityWeight: roundScore(term.communityWeight),
    weightedTerm: roundScore(term.weightedTerm),
  }));
  if (signalSum === 0) {
    return {
      formulaApplied: true,
      defaultTopicWeight: DEFAULT_TOPIC_WEIGHT,
      confidenceThreshold: TOPIC_CONFIDENCE_THRESHOLD,
      weightedSum: 0,
      signalSum: 0,
      baseRelevance: DEFAULT_TOPIC_WEIGHT,
      confidenceMultiplier: 1,
      effectiveRelevance: DEFAULT_TOPIC_WEIGHT,
      usedDefaultWeight: terms.some((term) => term.usedDefaultWeight),
      terms,
    };
  }

  const baseRelevance = weightedSum / signalSum;
  const confidenceMultiplier = Math.min(1, signalSum / TOPIC_CONFIDENCE_THRESHOLD);
  const effectiveRelevance = Math.max(0, Math.min(1, baseRelevance * confidenceMultiplier));
  return {
    formulaApplied: true,
    defaultTopicWeight: DEFAULT_TOPIC_WEIGHT,
    confidenceThreshold: TOPIC_CONFIDENCE_THRESHOLD,
    weightedSum: roundScore(weightedSum),
    signalSum: roundScore(signalSum),
    baseRelevance: roundScore(baseRelevance),
    confidenceMultiplier: roundScore(confidenceMultiplier),
    effectiveRelevance: roundScore(effectiveRelevance),
    usedDefaultWeight: terms.some((term) => term.usedDefaultWeight),
    terms,
  };
}

export function internalWeightsToShadow(weights: ShadowDemoInternalWeights): ShadowDemoWeights {
  const wire = {} as ShadowDemoWeights;
  for (const key of SHADOW_DEMO_INTERNAL_SIGNAL_KEYS) {
    wire[INTERNAL_TO_WIRE[key]] = weights[key];
  }
  return normalizeShadowWeights(wire);
}

export function shadowWeightsToInternal(weights: ShadowDemoWeights): ShadowDemoInternalWeights {
  const internal = {} as ShadowDemoInternalWeights;
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    internal[WIRE_TO_INTERNAL[key]] = weights[key];
  }
  return internal;
}

export function internalRawScoresToShadow(
  components: Record<string, { raw: number }>
): ShadowDemoRawScores {
  const rawScores = {} as ShadowDemoRawScores;
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const internalKey = WIRE_TO_INTERNAL[key];
    const component = components[internalKey];
    rawScores[key] = component && Number.isFinite(component.raw) ? component.raw : 0;
  }
  return rawScores;
}

export function engagementOnlyWeights(): ShadowDemoWeights {
  return {
    recency: 0,
    engagement: 1,
    bridging: 0,
    source_diversity: 0,
    relevance: 0,
  };
}

export function equalShadowWeights(): ShadowDemoWeights {
  return {
    recency: 0.2,
    engagement: 0.2,
    bridging: 0.2,
    source_diversity: 0.2,
    relevance: 0.2,
  };
}

export function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function sumWeights(weights: ShadowDemoWeights): number {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((sum, key) => sum + weights[key], 0);
}

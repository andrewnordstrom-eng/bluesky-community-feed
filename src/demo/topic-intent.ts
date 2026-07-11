import {
  SHADOW_DEMO_TOPIC_KEYS,
  type ShadowDemoTopicIntent,
  type ShadowDemoTopicKey,
} from './types.js';
import { aggregateRowsWithTrimmedMean } from '../governance/aggregation-math.js';

const MAX_TOPIC_IDENTIFIER_LENGTH = 64;
const ALLOWED_TOPICS = new Set<ShadowDemoTopicKey>(SHADOW_DEMO_TOPIC_KEYS);

export function validateShadowTopicIntent(value: unknown): ShadowDemoTopicIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Shadow demo topic intent must be an object');
  }
  const topicWeightsValue = (value as Record<string, unknown>).topicWeights;
  if (!topicWeightsValue || typeof topicWeightsValue !== 'object' || Array.isArray(topicWeightsValue)) {
    throw new Error('Shadow demo topic intent must include topicWeights');
  }

  const entries = Object.entries(topicWeightsValue as Record<string, unknown>);
  if (entries.length > SHADOW_DEMO_TOPIC_KEYS.length) {
    throw new Error(`Shadow demo topic intent supports at most ${SHADOW_DEMO_TOPIC_KEYS.length} topics`);
  }

  const topicWeights: Record<string, number> = {};
  for (const [slug, rawWeight] of entries) {
    if (slug.length > MAX_TOPIC_IDENTIFIER_LENGTH || !ALLOWED_TOPICS.has(slug as ShadowDemoTopicKey)) {
      throw new Error(`Shadow demo topic is not allowed: ${slug}`);
    }
    if (typeof rawWeight !== 'number' || !Number.isFinite(rawWeight)) {
      throw new Error(`Shadow demo topic weight ${slug} must be finite`);
    }
    if (rawWeight < 0 || rawWeight > 1) {
      throw new Error(`Shadow demo topic weight ${slug} must be between 0 and 1`);
    }
    topicWeights[slug] = rawWeight;
  }

  return { topicWeights };
}

export function aggregateShadowTopicIntents(
  intents: readonly ShadowDemoTopicIntent[]
): ShadowDemoTopicIntent {
  const slugs = Array.from(
    new Set(intents.flatMap((intent) => Object.keys(intent.topicWeights)))
  ).sort();
  const topicWeights: Record<string, number> = {};

  for (const slug of slugs) {
    const values = intents
      .map((intent) => intent.topicWeights[slug])
      .filter((value): value is number => value !== undefined);
    if (values.length === 0) {
      continue;
    }
    const aggregation = aggregateRowsWithTrimmedMean({
      rows: values.map((value) => ({ value })),
      components: ['value'],
    });
    topicWeights[slug] = Math.round(aggregation.values.value * 1000) / 1000;
  }

  return { topicWeights };
}

export function emptyShadowTopicIntent(): ShadowDemoTopicIntent {
  return { topicWeights: {} };
}

export function cloneShadowTopicIntent(intent: ShadowDemoTopicIntent): ShadowDemoTopicIntent {
  return { topicWeights: { ...intent.topicWeights } };
}

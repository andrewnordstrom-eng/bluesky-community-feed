/**
 * Shadow-demo content-rules ballot channel (exclude keywords only).
 *
 * Mirrors the production mechanism with the production matcher and the
 * production support-threshold share, but over the demo's complete
 * electorate: every demo ballot is complete (weights + full topic catalog),
 * so the adoption denominator is all 25 ballots rather than production's
 * "voters who cast a content ballot" subset.
 *
 * Deliberate divergences from production, documented in
 * docs/lab/demo-shadow-governance-contract.md:
 * - exclude keywords only (an include list can empty a 65-post frozen corpus);
 * - no safety-net default rules (the frozen corpus is already reviewer-safe);
 * - adoption threshold is computed over the full 25-ballot electorate.
 */

import { checkContentRules } from '../governance/content-filter.js';
import { normalizeKeywords } from '../governance/governance.types.js';
import {
  SHADOW_DEMO_CONTENT_RULE_SUPPORT_THRESHOLD,
  SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS,
  SHADOW_DEMO_MAX_EXCLUDE_KEYWORD_LENGTH,
  type ShadowDemoContentRulesSummary,
  type ShadowDemoCorpusItem,
  type ShadowDemoSuggestedExcludeKeyword,
  type ShadowDemoVote,
  type ShadowDemoVoterBlocId,
} from './types.js';

/**
 * How readily each bloc echoes a reviewer-proposed exclude keyword.
 * Tuned so a proposal lands near the adoption threshold: expected echoes
 * across the 24 synthetic voters ~= 7.7 against a threshold of 8-of-25,
 * so adoption depends on the session seed, epoch, and keyword.
 */
const CONTENT_RULE_ECHO_RATES: Record<ShadowDemoVoterBlocId, number> = {
  freshness_watcher: 0.45,
  conversation_follower: 0.3,
  bridge_builder: 0.2,
  source_diversifier: 0.2,
  relevance_steward: 0.45,
  research_practitioner: 0.3,
  dataset_steward: 0.3,
  current_awareness: 0.3,
  community_discussant: 0.3,
  interdisciplinary_connector: 0.3,
};

/** Extra support for keywords already adopted into the prior shadow policy. */
const CONTENT_RULE_INERTIA_BONUS = 0.2;

const SUGGESTED_KEYWORD_STOPWORDS = new Set([
  'about', 'after', 'against', 'all', 'also', 'and', 'any', 'are', 'back',
  'because', 'been', 'before', 'being', 'between', 'both', 'but', 'can',
  'could', 'did', 'does', 'doing', 'down', 'each', 'even', 'first', 'for',
  'from', 'get', 'got', 'had', 'has', 'have', 'her', 'here', 'him', 'his',
  'how', 'into', 'its', 'just', 'like', 'made', 'make', 'many', 'more',
  'most', 'much', 'need', 'new', 'not', 'now', 'off', 'one', 'only', 'other',
  'our', 'out', 'over', 'own', 'people', 'same', 'she', 'should', 'since',
  'some', 'still', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'thing', 'things', 'this', 'those', 'through',
  'time', 'too', 'use', 'using', 'very', 'want', 'was', 'way', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would',
  'you', 'your',
]);

const SUGGESTED_KEYWORD_MIN_LENGTH = 4;
const SUGGESTED_KEYWORD_MIN_MATCHES = 2;
/** Skip terms that would withhold most of the corpus in one vote. */
const SUGGESTED_KEYWORD_MAX_CORPUS_SHARE = 0.3;
/** How many corpus-grounded exclude suggestions the session exposes. */
export const SHADOW_DEMO_SUGGESTED_KEYWORD_COUNT = 6;

export function validateShadowExcludeKeywords(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Shadow demo excludeKeywords must be an array of strings');
  }
  if (value.length > SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS) {
    throw new Error(
      `Shadow demo excludeKeywords accepts at most ${SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS} keywords`
    );
  }
  for (const keyword of value) {
    if (typeof keyword !== 'string') {
      throw new Error('Shadow demo excludeKeywords must contain only strings');
    }
    if (keyword.trim().length === 0) {
      throw new Error('Shadow demo excludeKeywords must not contain empty keywords');
    }
    if (keyword.trim().length > SHADOW_DEMO_MAX_EXCLUDE_KEYWORD_LENGTH) {
      throw new Error(
        `Shadow demo exclude keywords are limited to ${SHADOW_DEMO_MAX_EXCLUDE_KEYWORD_LENGTH} characters`
      );
    }
  }
  return normalizeKeywords(value).slice(0, SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS);
}

/**
 * Aggregate exclude-keyword ballots with the production support-threshold
 * rule over the full demo electorate. Distinct from the trimmed-mean path
 * used for weights and topic intents.
 */
export function aggregateShadowContentRules(
  votes: ReadonlyArray<Pick<ShadowDemoVote, 'excludeKeywords'>>,
  electorate: number
): ShadowDemoContentRulesSummary {
  const threshold = contentRuleThreshold(electorate);
  const supportCounts = new Map<string, number>();
  for (const vote of votes) {
    for (const keyword of vote.excludeKeywords ?? []) {
      supportCounts.set(keyword, (supportCounts.get(keyword) ?? 0) + 1);
    }
  }
  const support = [...supportCounts.entries()]
    .map(([keyword, supportCount]) => ({
      keyword,
      supportCount,
      adopted: supportCount >= threshold,
    }))
    .sort((left, right) =>
      right.supportCount - left.supportCount || left.keyword.localeCompare(right.keyword)
    );
  // Cap the active exclude-rule set at the per-ballot keyword limit, ranked by
  // support (highest first, ties alphabetical). Prior-policy inertia can carry
  // rules across epochs, so an uncapped adopted set could grow past the limit
  // enforced on the persisted policy; the highest-support rules win.
  const adoptedExcludeKeywords = support
    .filter((entry) => entry.adopted)
    .slice(0, SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS)
    .map((entry) => entry.keyword)
    .sort();
  return {
    enabled: true,
    threshold,
    electorate,
    adoptedExcludeKeywords,
    support,
  };
}

export function contentRuleThreshold(electorate: number): number {
  return Math.max(1, Math.ceil(electorate * SHADOW_DEMO_CONTENT_RULE_SUPPORT_THRESHOLD));
}

export function emptyShadowContentRules(electorate: number): ShadowDemoContentRulesSummary {
  return {
    enabled: true,
    threshold: contentRuleThreshold(electorate),
    electorate,
    adoptedExcludeKeywords: [],
    support: [],
  };
}

/**
 * Deterministic exclude-keyword ballot for one synthetic voter.
 * A voter backs a keyword when it echoes the reviewer's proposal
 * (seeded per keyword) or sustains a previously adopted rule (inertia).
 * Synthetic voters never originate their own keywords.
 */
export function syntheticExcludeKeywords(options: {
  seed: string;
  communityId: string;
  epochId: string;
  actorId: string;
  blocId: ShadowDemoVoterBlocId;
  policyInertia: number;
  reviewerExcludeKeywords: readonly string[];
  priorAdoptedExcludeKeywords: readonly string[];
}): string[] {
  const echoRate = CONTENT_RULE_ECHO_RATES[options.blocId];
  const inertiaRate = Math.min(0.95, options.policyInertia + CONTENT_RULE_INERTIA_BONUS);
  const candidates = new Set([
    ...options.reviewerExcludeKeywords,
    ...options.priorAdoptedExcludeKeywords,
  ]);
  const backed: string[] = [];
  for (const keyword of [...candidates].sort()) {
    const echoes = options.reviewerExcludeKeywords.includes(keyword)
      && deterministicUnit(
        `${options.seed}:${options.communityId}:${options.epochId}:${options.actorId}:rule-echo:${keyword}`
      ) < echoRate;
    const sustains = options.priorAdoptedExcludeKeywords.includes(keyword)
      && deterministicUnit(
        `${options.seed}:${options.communityId}:${options.epochId}:${options.actorId}:rule-inertia:${keyword}`
      ) < inertiaRate;
    if (echoes || sustains) {
      backed.push(keyword);
    }
  }
  return backed.slice(0, SHADOW_DEMO_MAX_EXCLUDE_KEYWORDS);
}

export interface ShadowContentRuleApplication {
  eligible: ShadowDemoCorpusItem[];
  withheld: Array<{ item: ShadowDemoCorpusItem; keyword: string }>;
}

/**
 * Split the frozen corpus into eligible and withheld items under the adopted
 * exclude keywords, using the production matcher (prefix matching, exclude
 * precedence). Hidden posts carry no text and always pass.
 */
export function applyShadowContentRules(
  items: readonly ShadowDemoCorpusItem[],
  adoptedExcludeKeywords: readonly string[]
): ShadowContentRuleApplication {
  if (adoptedExcludeKeywords.length === 0) {
    return { eligible: [...items], withheld: [] };
  }
  const rules = {
    includeKeywords: [],
    excludeKeywords: [...adoptedExcludeKeywords],
  };
  const eligible: ShadowDemoCorpusItem[] = [];
  const withheld: Array<{ item: ShadowDemoCorpusItem; keyword: string }> = [];
  for (const item of items) {
    const text = item.displayPost.kind === 'public_post' ? item.displayPost.text : null;
    const result = checkContentRules(text, rules);
    if (result.passes) {
      eligible.push(item);
    } else {
      withheld.push({ item, keyword: result.matchedKeyword ?? adoptedExcludeKeywords[0] });
    }
  }
  return { eligible, withheld };
}

/**
 * Deterministic exclude-keyword suggestions drawn from the frozen corpus,
 * so a proposed rule always has a visible effect. Terms that would withhold
 * most of the corpus, or almost none of it, are skipped.
 */
export function suggestedExcludeKeywords(
  items: readonly ShadowDemoCorpusItem[],
  limit: number
): ShadowDemoSuggestedExcludeKeyword[] {
  const postsPerTerm = new Map<string, number>();
  let publicPostCount = 0;
  for (const item of items) {
    if (item.displayPost.kind !== 'public_post') {
      continue;
    }
    publicPostCount += 1;
    const terms = new Set(
      item.displayPost.text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) =>
          term.length >= SUGGESTED_KEYWORD_MIN_LENGTH
          && term.length <= SHADOW_DEMO_MAX_EXCLUDE_KEYWORD_LENGTH
          && !SUGGESTED_KEYWORD_STOPWORDS.has(term)
          && !/^\d+$/.test(term)
        )
    );
    for (const term of terms) {
      postsPerTerm.set(term, (postsPerTerm.get(term) ?? 0) + 1);
    }
  }
  if (publicPostCount === 0) {
    return [];
  }
  const maxMatches = Math.max(
    SUGGESTED_KEYWORD_MIN_MATCHES,
    Math.floor(publicPostCount * SUGGESTED_KEYWORD_MAX_CORPUS_SHARE)
  );
  return [...postsPerTerm.entries()]
    .filter(([, count]) => count >= SUGGESTED_KEYWORD_MIN_MATCHES && count <= maxMatches)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([keyword, matchCount]) => ({ keyword, matchCount }));
}

/** Seeded FNV-1a hash to [0, 1); same determinism pattern as vote jitter. */
function deterministicUnit(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

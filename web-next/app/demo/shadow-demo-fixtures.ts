// Deterministic fixtures + pure ranking engine for the shadow-governance demo.
//
// Everything here is contract-keyed (snake_case signal keys) and pure — no React,
// no I/O, no Math.random / Date.now. The Open Science Builders corpus, voters, and
// presets are adapted from the shared replay model (`lib/replay-model.ts`) so the
// numeric behavior stays consistent with the landing / how-it-works replays, but
// re-keyed to the `shadow-demo-contract.ts` shapes the mock client returns.
//
// The engine is the source of truth for: ranking a frozen corpus under a set of
// weights, aggregating votes (equal-voter average), and computing the three
// receipt counterfactuals. The mock client wraps these in envelopes + phases.

import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoAgent,
  type ShadowDemoAgentId,
  type ShadowDemoCommunity,
  type ShadowDemoCommunityId,
  type ShadowDemoCounterfactual,
  type ShadowDemoFeedItem,
  type ShadowDemoPublicPost,
  type ShadowDemoRankMovement,
  type ShadowDemoScore,
  type ShadowDemoScoreComponent,
  type ShadowDemoSignalKey,
  type ShadowDemoTopicContribution,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from "./shadow-demo-contract"

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// Signal labels + the warm palette live in the shared source (`lib/signals`) so
// the demo, the governance surfaces, and the replay surfaces cannot drift apart.
// Imported for internal use and re-exported to keep the demo's import paths stable.
import { SIGNAL_COLORS, SIGNAL_LABELS } from "@/lib/signals"
export { SIGNAL_COLORS, SIGNAL_LABELS }

// ---------------------------------------------------------------------------
// Corpus (frozen per session)
// ---------------------------------------------------------------------------

export interface DemoCorpusEntry {
  /** Stable per-corpus id, also used to derive the at:// uri. */
  readonly id: string
  readonly post: ShadowDemoPublicPost
  /** Raw per-signal scores in 0..1 (contract-keyed). */
  readonly rawScores: Readonly<Record<ShadowDemoSignalKey, number>>
  /** Topic affinity in 0..1 for the community's topic slugs. */
  readonly topicAffinity: Readonly<Record<string, number>>
  /** When present the row is withheld from the public view (policy-safe). */
  readonly hidden?: {
    readonly reason: "no_unauthenticated" | "hide_label" | "adult_label" | "deleted_or_unavailable" | "missing_text"
    readonly labels: readonly string[]
  }
}

/** Real avatar photos (public/images/avatars) keyed by handle — matches the landing feed. */
const AVATARS: Readonly<Record<string, string>> = {
  "maya-keene.bsky.social": "/images/avatars/maya-keene.png",
  "toastwindow.bsky.social": "/images/avatars/claire-rowan.png",
  "arjunmehta.dev": "/images/avatars/arjun-mehta.png",
  "eli-overthinking.bsky.social": "/images/avatars/eli-moreno.png",
  "thocknotes.bsky.social": "/images/avatars/theo-kim.png",
  "ninavaldez.bsky.social": "/images/avatars/nina-valdez.png",
  "leilahart.bsky.social": "/images/avatars/leila-hart.png",
}

/** Fixed reference clock for the frozen corpus (keeps "x ago" labels deterministic). */
export const CORPUS_COLLECTED_AT = "2026-01-05T18:00:00.000Z"

function minutesBefore(reference: string, minutes: number): string {
  return new Date(new Date(reference).getTime() - minutes * 60_000).toISOString()
}

function makePost(
  id: string,
  authorDisplayName: string,
  authorHandle: string,
  minutesAgo: number,
  text: string,
  counts: { readonly like: number; readonly repost: number; readonly reply: number; readonly quote: number },
  labels: readonly string[] = [],
): ShadowDemoPublicPost {
  return {
    uri: `at://did:plc:corgidemo${id.toLowerCase()}/app.bsky.feed.post/${id}`,
    cid: `bafyreidemo${id.toLowerCase()}`,
    bskyUrl: `https://bsky.app/profile/${authorHandle}/post/${id}`,
    authorHandle,
    authorDisplayName,
    authorAvatar: AVATARS[authorHandle] ?? null,
    text,
    indexedAt: minutesBefore(CORPUS_COLLECTED_AT, minutesAgo),
    likeCount: counts.like,
    repostCount: counts.repost,
    replyCount: counts.reply,
    quoteCount: counts.quote,
    labels,
  }
}

/**
 * Open Science Builders corpus — 7 public posts + 1 policy-withheld row. Numeric
 * scores are carried over from lib/replay-model so the reorderings are already
 * tuned to read well. Topic slugs: field_notes / datasets / sightings / culture.
 */
const OPEN_SCIENCE_CORPUS: readonly DemoCorpusEntry[] = [
  {
    id: "P1",
    post: makePost("P1", "Maya Keene", "maya-keene.bsky.social", 14, "Built a tiny script to log neighborhood finch sightings from my morning walks.", { like: 164, repost: 42, reply: 18, quote: 6 }),
    rawScores: { recency: 0.72, engagement: 0.42, bridging: 0.92, source_diversity: 0.68, relevance: 0.9 },
    topicAffinity: { "science-research": 0.85, "data-science": 0.45, "software-development": 0.55, "open-source": 0.6 },
  },
  {
    id: "P2",
    post: makePost("P2", "Claire Rowan", "toastwindow.bsky.social", 6, "Rare tanager spotted near the east trailhead this morning.", { like: 112, repost: 25, reply: 9, quote: 3 }),
    rawScores: { recency: 0.96, engagement: 0.35, bridging: 0.28, source_diversity: 0.55, relevance: 0.82 },
    topicAffinity: { "science-research": 0.95, "data-science": 0.2, "software-development": 0.1, "open-source": 0.1 },
  },
  {
    id: "P3",
    post: makePost("P3", "Arjun Mehta", "arjunmehta.dev", 31, "This CSS bug has haunted me for three days.", { like: 208, repost: 36, reply: 21, quote: 8 }),
    rawScores: { recency: 0.64, engagement: 0.58, bridging: 0.22, source_diversity: 0.42, relevance: 0.48 },
    topicAffinity: { "science-research": 0.2, "data-science": 0.2, "software-development": 0.75, "open-source": 0.25 },
  },
  {
    id: "P4",
    post: makePost("P4", "Eli Moreno", "eli-overthinking.bsky.social", 18, "Programmers will do anything except go outside.", { like: 4200, repost: 511, reply: 86, quote: 74 }),
    rawScores: { recency: 0.7, engagement: 0.95, bridging: 0.3, source_diversity: 0.35, relevance: 0.36 },
    topicAffinity: { "science-research": 0.15, "data-science": 0.1, "software-development": 0.7, "open-source": 0.2 },
  },
  {
    id: "P5",
    post: makePost("P5", "Theo Kim", "thocknotes.bsky.social", 23, "Open-source bird-call classifier dataset just dropped.", { like: 340, repost: 96, reply: 32, quote: 19 }),
    rawScores: { recency: 0.68, engagement: 0.62, bridging: 0.88, source_diversity: 0.84, relevance: 0.94 },
    topicAffinity: { "science-research": 0.65, "data-science": 0.95, "software-development": 0.8, "open-source": 0.95 },
  },
  {
    id: "P6",
    post: makePost("P6", "Nina Valdez", "ninavaldez.bsky.social", 60, "Field notes from a rainy owl survey, plus the messy CSV.", { like: 88, repost: 19, reply: 7, quote: 2 }),
    rawScores: { recency: 0.46, engagement: 0.28, bridging: 0.74, source_diversity: 0.72, relevance: 0.86 },
    topicAffinity: { "science-research": 0.9, "data-science": 0.8, "software-development": 0.45, "open-source": 0.7 },
  },
  {
    id: "P7",
    post: makePost("P7", "Leila Hart", "leilahart.bsky.social", 16, "My camera roll is 80% blurry sparrows and 20% screenshots of stack traces.", { like: 261, repost: 54, reply: 15, quote: 11 }),
    rawScores: { recency: 0.75, engagement: 0.66, bridging: 0.7, source_diversity: 0.52, relevance: 0.76 },
    topicAffinity: { "science-research": 0.45, "data-science": 0.35, "software-development": 0.75, "open-source": 0.4 },
  },
  {
    // A policy-withheld row: exercises the compact hidden feed item. It still
    // occupies a rank slot but renders no text / handle / avatar.
    id: "H1",
    post: makePost("H1", "", "", 40, "", { like: 0, repost: 0, reply: 0, quote: 0 }, ["!hide"]),
    rawScores: { recency: 0.5, engagement: 0.3, bridging: 0.4, source_diversity: 0.45, relevance: 0.55 },
    topicAffinity: { "science-research": 0.3, "data-science": 0.3, "software-development": 0.3, "open-source": 0.2 },
    hidden: { reason: "hide_label", labels: ["!hide"] },
  },
] as const

export interface DemoTopicMeta {
  readonly slug: string
  readonly label: string
}

export interface DemoCommunityFixture {
  readonly community: ShadowDemoCommunity
  /** Only Open Science Builders is fully built this pass; others are previews. */
  readonly isPreview: boolean
  readonly corpus: readonly DemoCorpusEntry[]
  readonly topics: readonly DemoTopicMeta[]
}

const OPEN_SCIENCE_TOPICS: readonly DemoTopicMeta[] = [
  { slug: "science-research", label: "Science & research" },
  { slug: "data-science", label: "Data science" },
  { slug: "software-development", label: "Software development" },
  { slug: "open-source", label: "Open source" },
] as const

export const DEMO_COMMUNITIES: Readonly<Record<ShadowDemoCommunityId, DemoCommunityFixture>> = {
  open_science_builders: {
    isPreview: false,
    community: {
      id: "open_science_builders",
      name: "Open Science Builders",
      tagline: "Research, reusable datasets, open-source methods, and the software that moves knowledge across disciplines.",
      corpusStrategy: "live_appview_search",
      candidateTerms: ["science", "research", "data science", "software development", "open source"],
      bridgeTerms: ["dataset", "reproducible", "method", "tooling"],
      publicBlueskyFeedUrl: null,
    },
    corpus: OPEN_SCIENCE_CORPUS,
    topics: OPEN_SCIENCE_TOPICS,
  },
  birders_who_code: {
    isPreview: true,
    community: {
      id: "birders_who_code",
      name: "Birders Who Code",
      tagline: "Field reports, open datasets, debugging notes, and the jokes that make both hobbies human.",
      corpusStrategy: "fixture_fallback",
      candidateTerms: ["birding", "field notes", "dataset", "sighting", "open source"],
      bridgeTerms: ["code", "data", "survey"],
      publicBlueskyFeedUrl: null,
    },
    corpus: [],
    topics: [],
  },
  crit_fumble_pickup: {
    isPreview: true,
    community: {
      id: "crit_fumble_pickup",
      name: "Crit Fumble Pickup",
      tagline: "Rules debates, painted minis, session logs, and dramatic dice stories.",
      corpusStrategy: "fixture_fallback",
      candidateTerms: ["tabletop", "ttrpg", "miniatures", "session log"],
      bridgeTerms: ["rules", "design", "storytelling"],
      publicBlueskyFeedUrl: null,
    },
    corpus: [],
    topics: [],
  },
  osint_garden_club: {
    isPreview: true,
    community: {
      id: "osint_garden_club",
      name: "OSINT Garden Club",
      tagline: "Satellite sleuthing, public records, botany threads, and surprisingly intense plant IDs.",
      corpusStrategy: "fixture_fallback",
      candidateTerms: ["osint", "satellite", "public records", "botany"],
      bridgeTerms: ["geolocation", "ecology", "verification"],
      publicBlueskyFeedUrl: null,
    },
    corpus: [],
    topics: [],
  },
}

export function getCommunityFixture(id: ShadowDemoCommunityId): DemoCommunityFixture {
  return DEMO_COMMUNITIES[id]
}

export const DEFAULT_COMMUNITY_ID: ShadowDemoCommunityId = "open_science_builders"

// ---------------------------------------------------------------------------
// Agents (deterministic, fixed weight vectors + checked-in rationale)
// ---------------------------------------------------------------------------

export interface DemoAgentFixture {
  readonly agent: ShadowDemoAgent
  readonly weights: ShadowDemoWeights
}

export const DEMO_AGENTS: readonly DemoAgentFixture[] = [
  {
    agent: {
      id: "research_practitioner",
      name: "Research Practitioners",
      role: "Want methods, observations, and field context to survive the scroll.",
      deterministicSeed: "voter:research_practitioner",
      voteRationale: "Boost source-rich notes and research that other people can inspect or reproduce.",
      voterCount: 5,
      baseWeights: { recency: 0.18, engagement: 0.07, bridging: 0.14, source_diversity: 0.31, relevance: 0.3 },
      reviewerBlend: 0.18,
      policyInertia: 0.27,
    },
    weights: { recency: 0.18, engagement: 0.07, bridging: 0.14, source_diversity: 0.31, relevance: 0.3 },
  },
  {
    agent: {
      id: "dataset_steward",
      name: "Data Stewards",
      role: "Cares about reproducible data, open tooling, and reusable context.",
      deterministicSeed: "voter:dataset_steward",
      voteRationale: "Raises datasets, messy CSVs, classifiers, and well-labeled observations.",
      voterCount: 5,
      baseWeights: { recency: 0.1, engagement: 0.06, bridging: 0.24, source_diversity: 0.28, relevance: 0.32 },
      reviewerBlend: 0.22,
      policyInertia: 0.3,
    },
    weights: { recency: 0.1, engagement: 0.06, bridging: 0.24, source_diversity: 0.28, relevance: 0.32 },
  },
  {
    agent: {
      id: "current_awareness",
      name: "Current-Awareness Readers",
      role: "Wants the feed to notice time-sensitive findings before they go stale.",
      deterministicSeed: "voter:current_awareness",
      voteRationale: "Pushes recency without letting generic virality take over the community.",
      voterCount: 5,
      baseWeights: { recency: 0.52, engagement: 0.06, bridging: 0.08, source_diversity: 0.08, relevance: 0.26 },
      reviewerBlend: 0.2,
      policyInertia: 0.24,
    },
    weights: { recency: 0.52, engagement: 0.06, bridging: 0.08, source_diversity: 0.08, relevance: 0.26 },
  },
  {
    agent: {
      id: "community_discussant",
      name: "Community Discussants",
      role: "Value popular discussions, as long as the community can rebalance them.",
      deterministicSeed: "voter:community_discussant",
      voteRationale: "Gives engagement real weight so funny posts can win when the community chooses that.",
      voterCount: 4,
      baseWeights: { recency: 0.13, engagement: 0.55, bridging: 0.08, source_diversity: 0.04, relevance: 0.2 },
      reviewerBlend: 0.16,
      policyInertia: 0.2,
    },
    weights: { recency: 0.13, engagement: 0.55, bridging: 0.08, source_diversity: 0.04, relevance: 0.2 },
  },
  {
    agent: {
      id: "interdisciplinary_connector",
      name: "Interdisciplinary Connectors",
      role: "Want posts that connect researchers, developers, maintainers, and data practitioners.",
      deterministicSeed: "voter:interdisciplinary_connector",
      voteRationale: "Rewards posts that carry useful context across subgroups inside the feed.",
      voterCount: 5,
      baseWeights: { recency: 0.12, engagement: 0.08, bridging: 0.42, source_diversity: 0.13, relevance: 0.25 },
      reviewerBlend: 0.24,
      policyInertia: 0.32,
    },
    weights: { recency: 0.12, engagement: 0.08, bridging: 0.42, source_diversity: 0.13, relevance: 0.25 },
  },
]

export const DEMO_AGENT_IDS: readonly ShadowDemoAgentId[] = DEMO_AGENTS.map((entry) => entry.agent.id)

// ---------------------------------------------------------------------------
// Reviewer vote presets (map to lib/replay-model epochs)
// ---------------------------------------------------------------------------

export interface DemoVotePreset {
  readonly id: string
  readonly label: string
  readonly summary: string
  readonly weights: ShadowDemoWeights
  readonly topicIntent: ShadowDemoTopicIntent
}

export const DEMO_VOTE_PRESETS: readonly DemoVotePreset[] = [
  {
    id: "field_notes",
    label: "Reproducible work",
    summary: "Methods, datasets, and inspectable results get room so they do not vanish under announcements.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.15, source_diversity: 0.3, relevance: 0.3 },
    topicIntent: {
      topicWeights: { "science-research": 0.9, "data-science": 0.85, "software-development": 0.55, "open-source": 0.8 },
    },
  },
  {
    id: "bridge_building",
    label: "Bridge-building",
    summary: "Rewards work that connects researchers, data practitioners, and software maintainers.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.35, source_diversity: 0.15, relevance: 0.25 },
    topicIntent: {
      topicWeights: { "science-research": 0.8, "data-science": 0.8, "software-development": 0.8, "open-source": 0.8 },
    },
  },
  {
    id: "freshness",
    label: "Freshness push",
    summary: "Time-sensitive findings rise without making likes the whole policy.",
    weights: { recency: 0.55, engagement: 0.05, bridging: 0.05, source_diversity: 0.05, relevance: 0.3 },
    topicIntent: {
      topicWeights: { "science-research": 0.9, "data-science": 0.6, "software-development": 0.45, "open-source": 0.5 },
    },
  },
  {
    id: "engagement",
    label: "Engagement-heavy",
    summary: "Lets popular announcements win, making the default failure mode easy to compare.",
    weights: { recency: 0.05, engagement: 0.65, bridging: 0.05, source_diversity: 0.05, relevance: 0.2 },
    topicIntent: {
      topicWeights: { "science-research": 0.45, "data-science": 0.45, "software-development": 0.6, "open-source": 0.5 },
    },
  },
]

export function getPresetById(id: string): DemoVotePreset | undefined {
  return DEMO_VOTE_PRESETS.find((preset) => preset.id === id)
}

/** Starting policy before the reviewer votes — the engagement-heavy failure mode. */
export const BASELINE_WEIGHTS: ShadowDemoWeights = {
  recency: 0.05,
  engagement: 0.65,
  bridging: 0.05,
  source_diversity: 0.05,
  relevance: 0.2,
}

export const BASELINE_TOPIC_INTENT: ShadowDemoTopicIntent = {
  topicWeights: { "science-research": 0.45, "data-science": 0.45, "software-development": 0.6, "open-source": 0.5 },
}

// ---------------------------------------------------------------------------
// Pure engine
// ---------------------------------------------------------------------------

const ZERO_WEIGHTS: ShadowDemoWeights = {
  recency: 0,
  engagement: 0,
  bridging: 0,
  source_diversity: 0,
  relevance: 0,
}

/** Renormalize any non-negative weight vector to sum to 1.0. Throws on empty/negative. */
export function normalizeWeights(weights: ShadowDemoWeights): ShadowDemoWeights {
  let total = 0
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    const value = weights[key]
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid weight for ${key}: ${value}`)
    }
    total += value
  }
  if (total <= 0) {
    throw new Error("Cannot normalize weights that sum to zero")
  }
  const out = { ...ZERO_WEIGHTS }
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    out[key] = weights[key] / total
  }
  return out
}

export function trimmedVoterAverage(votes: readonly ShadowDemoWeights[]): ShadowDemoWeights {
  if (votes.length === 0) {
    throw new Error("Cannot aggregate zero demo voters")
  }
  const trimCount = votes.length >= 10 ? Math.floor(votes.length * 0.1) : 0
  const averaged = Object.fromEntries(SHADOW_DEMO_SIGNAL_KEYS.map((key) => {
    const values = votes.map((vote) => vote[key]).sort((left, right) => left - right)
    const retained = trimCount > 0 ? values.slice(trimCount, values.length - trimCount) : values
    return [key, retained.reduce((sum, value) => sum + value, 0) / retained.length]
  })) as ShadowDemoWeights
  return normalizeWeights(averaged)
}

/** Equal-voter average of a list of (already valid) weight vectors, renormalized. */
export function equalVoterAverage(votes: readonly ShadowDemoWeights[]): ShadowDemoWeights {
  if (votes.length === 0) {
    throw new Error("equalVoterAverage requires at least one vote")
  }
  const sum = { ...ZERO_WEIGHTS }
  for (const vote of votes) {
    const normalized = normalizeWeights(vote)
    for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
      sum[key] += normalized[key]
    }
  }
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    sum[key] /= votes.length
  }
  return normalizeWeights(sum)
}

export function contribution(rawScore: number, weight: number): number {
  return rawScore * weight
}

/** Weighted total for one corpus entry under a weight vector. */
export function scoreEntry(entry: DemoCorpusEntry, weights: ShadowDemoWeights): number {
  let total = 0
  for (const key of SHADOW_DEMO_SIGNAL_KEYS) {
    total += contribution(entry.rawScores[key], weights[key])
  }
  return total
}

function buildScore(entry: DemoCorpusEntry, weights: ShadowDemoWeights): ShadowDemoScore {
  const components: ShadowDemoScoreComponent[] = SHADOW_DEMO_SIGNAL_KEYS.map((key) => {
    const rawScore = entry.rawScores[key]
    const weight = weights[key]
    return {
      key,
      label: SIGNAL_LABELS[key],
      rawScore,
      weight,
      contribution: contribution(rawScore, weight),
    }
  })
  const total = components.reduce((sum, component) => sum + component.contribution, 0)
  return { total, components }
}

function movementFor(rank: number, previousRank: number | null): ShadowDemoRankMovement {
  if (previousRank === null) {
    return { delta: 0, label: "new" }
  }
  const delta = previousRank - rank
  if (delta === 0) {
    return { delta: 0, label: "same" }
  }
  return { delta, label: delta > 0 ? "up" : "down" }
}

/** Ranked entry ids (highest score first) under a weight vector — the ordering primitive. */
export function rankedIds(corpus: readonly DemoCorpusEntry[], weights: ShadowDemoWeights): readonly string[] {
  return corpus
    .map((entry) => ({ id: entry.id, score: scoreEntry(entry, weights) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((row) => row.id)
}

export interface RankCorpusResult {
  readonly items: readonly ShadowDemoFeedItem[]
  /** rank (1-indexed) of every entry id under these weights — used for counterfactuals. */
  readonly rankById: Readonly<Record<string, number>>
}

/**
 * Rank the frozen corpus under a weight vector into contract feed items, with
 * rank movement vs an optional previous rank map. Deterministic.
 */
export function rankCorpus(
  corpus: readonly DemoCorpusEntry[],
  weights: ShadowDemoWeights,
  previousRankById: Readonly<Record<string, number>> | null,
): RankCorpusResult {
  const order = rankedIds(corpus, weights)
  const rankById: Record<string, number> = {}
  order.forEach((id, index) => {
    rankById[id] = index + 1
  })

  const entryById = new Map(corpus.map((entry) => [entry.id, entry]))
  const items: ShadowDemoFeedItem[] = order.map((id) => {
    const entry = entryById.get(id)
    if (entry === undefined) {
      throw new Error(`Corpus entry not found: ${id}`)
    }
    const rank = rankById[id]
    const previousRank = previousRankById ? (previousRankById[id] ?? null) : null
    const movement = movementFor(rank, previousRank)

    if (entry.hidden) {
      return {
        visibility: "hidden",
        rank,
        previousRank,
        movement,
        post: null,
        score: null,
        hiddenReason: entry.hidden.reason,
        labels: entry.hidden.labels,
      }
    }
    return {
      visibility: "public",
      rank,
      previousRank,
      movement,
      post: entry.post,
      score: buildScore(entry, weights),
    }
  })

  return { items, rankById }
}

// ---------------------------------------------------------------------------
// Receipt helpers (topic breakdown + counterfactuals)
// ---------------------------------------------------------------------------

export function topicBreakdownFor(
  entry: DemoCorpusEntry,
  topics: readonly DemoTopicMeta[],
  topicIntent: ShadowDemoTopicIntent,
): readonly ShadowDemoTopicContribution[] {
  return topics
    .map((topic) => {
      const postScore = entry.topicAffinity[topic.slug] ?? 0
      const communityWeight = topicIntent.topicWeights[topic.slug] ?? 0
      return {
        slug: topic.slug,
        label: topic.label,
        postScore,
        communityWeight,
        contribution: postScore * communityWeight,
      }
    })
    .sort((left, right) => right.contribution - left.contribution)
}

const ENGAGEMENT_ONLY_WEIGHTS: ShadowDemoWeights = {
  recency: 0,
  engagement: 1,
  bridging: 0,
  source_diversity: 0,
  relevance: 0,
}

export interface CounterfactualContext {
  readonly corpus: readonly DemoCorpusEntry[]
  readonly postId: string
  readonly visibleRank: number
  /** Weights of the current (post-vote) epoch. */
  readonly currentWeights: ShadowDemoWeights
  /** Weights of the prior epoch (baseline, before the reviewer voted). */
  readonly priorWeights: ShadowDemoWeights
  /** Aggregate of agent votes only (excludes the reviewer). */
  readonly agentsOnlyWeights: ShadowDemoWeights
}

function rankOfPost(corpus: readonly DemoCorpusEntry[], postId: string, weights: ShadowDemoWeights): number {
  const index = rankedIds(corpus, weights).indexOf(postId)
  if (index < 0) {
    throw new Error(`Corpus entry not found for ranking: ${postId}`)
  }
  return index + 1
}

export function buildCounterfactuals(context: CounterfactualContext): readonly ShadowDemoCounterfactual[] {
  const priorRank = rankOfPost(context.corpus, context.postId, context.priorWeights)
  const engagementRank = rankOfPost(context.corpus, context.postId, ENGAGEMENT_ONLY_WEIGHTS)
  const withoutReviewerRank = rankOfPost(context.corpus, context.postId, context.agentsOnlyWeights)

  return [
    {
      id: "prior_epoch",
      label: "Prior epoch (before your vote)",
      rank: priorRank,
      deltaFromVisibleRank: priorRank - context.visibleRank,
    },
    {
      id: "engagement_only",
      label: "Engagement-only ranking",
      rank: engagementRank,
      deltaFromVisibleRank: engagementRank - context.visibleRank,
    },
    {
      id: "without_reviewer_vote",
      label: "Without your vote (agents only)",
      rank: withoutReviewerRank,
      deltaFromVisibleRank: withoutReviewerRank - context.visibleRank,
    },
  ]
}

// ---------------------------------------------------------------------------
// Small display helpers (deterministic; reference clock passed in)
// ---------------------------------------------------------------------------

export function formatRelativeTime(indexedAt: string | null, referenceAt: string): string {
  if (indexedAt === null) {
    return ""
  }
  const deltaMs = new Date(referenceAt).getTime() - new Date(indexedAt).getTime()
  const minutes = Math.max(0, Math.round(deltaMs / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.round(hours / 24)}d`
}

export function formatScore(value: number): string {
  return value.toFixed(3)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatCount(value: number | null): string {
  if (value === null) {
    return "0"
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`
  }
  return `${value}`
}

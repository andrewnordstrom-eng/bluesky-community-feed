export interface LiveScoreComponent {
  readonly key: string
  readonly label: string
  readonly raw_score: number
  readonly weight: number
  readonly weighted: number
}

export interface LiveFeedPostPreview {
  readonly rank: number
  readonly author: string
  readonly score: number
  readonly text: string
}

export interface LiveRankOneExplanation {
  readonly receiptId: string
  readonly authorLabel: string
  readonly text: string
  readonly epochId: number
  readonly totalScore: number
  readonly rank: number
  readonly components: readonly LiveScoreComponent[]
  readonly counterfactual: {
    readonly pureEngagementRank: number
    readonly communityGovernedRank: number
    readonly difference: number
  }
}

export const LIVE_METRICS_SNAPSHOT = {
  collectedAtLabel: "2026-07-07 03:00 UTC",
  epochId: 2,
  scoredPosts: 3348,
  uniqueAuthors: 3007,
  votesThisEpoch: 0,
  avgBridging: 0.7276394256303051,
  avgEngagement: 0.3226783153401943,
  medianBridging: 0.9186194653299917,
  medianTotal: 0.5312066730135393,
  weights: {
    recency: 0.25,
    engagement: 0.20,
    bridging: 0.10,
    source_diversity: 0.10,
    relevance: 0.35,
  },
  topics: [
    { slug: "decentralized-social", name: "Decentralized social", currentWeight: 0.90, communityAvg: 0.90 },
  ],
} as const

export const LIVE_RANK_ONE_COMPONENTS = [
  { key: "recency", label: "Recency", raw_score: 0.971876150243864, weight: LIVE_METRICS_SNAPSHOT.weights.recency, weighted: 0.242969037560966 },
  { key: "engagement", label: "Engagement", raw_score: 0.45384361090898817, weight: LIVE_METRICS_SNAPSHOT.weights.engagement, weighted: 0.09076872218179764 },
  { key: "bridging", label: "Bridging", raw_score: 0.9988304093567251, weight: LIVE_METRICS_SNAPSHOT.weights.bridging, weighted: 0.09988304093567252 },
  { key: "source_diversity", label: "Source diversity", raw_score: 1, weight: LIVE_METRICS_SNAPSHOT.weights.source_diversity, weighted: 0.1 },
  { key: "relevance", label: "Relevance", raw_score: 0.9, weight: LIVE_METRICS_SNAPSHOT.weights.relevance, weighted: 0.315 },
] as const satisfies readonly LiveScoreComponent[]

export const LIVE_RANK_ONE_EXPLANATION = {
  receiptId: "anonymized-live-receipt-rank-1",
  authorLabel: "Anonymized receipt 001",
  text: "Post text redacted; score structure preserved from a live Corgi receipt.",
  epochId: LIVE_METRICS_SNAPSHOT.epochId,
  totalScore: 0.8486208006784361,
  rank: 1,
  components: LIVE_RANK_ONE_COMPONENTS,
  counterfactual: {
    pureEngagementRank: 4,
    communityGovernedRank: 1,
    difference: 3,
  },
} as const satisfies LiveRankOneExplanation

export const LIVE_FEED_POSTS = [
  {
    rank: 1,
    author: "Anonymized receipt 001",
    score: 0.8486208006784361,
    text: "Post text redacted; score structure preserved from a live Corgi receipt.",
  },
  {
    rank: 2,
    author: "Anonymized receipt 002",
    score: 0.8447181456756023,
    text: "Post text redacted; receipt categorized around AI terminology and LLMs.",
  },
  {
    rank: 3,
    author: "Anonymized receipt 003",
    score: 0.8447074117364842,
    text: "Post text redacted; receipt categorized around generative AI adoption.",
  },
  {
    rank: 4,
    author: "Anonymized receipt 004",
    score: 0.8442263537240301,
    text: "Post text redacted; receipt categorized around generative AI in games.",
  },
] as const satisfies readonly LiveFeedPostPreview[]

export interface LiveScoreComponent {
  key: string
  label: string
  raw_score: number
  weight: number
  weighted: number
}

export interface LiveFeedPostPreview {
  rank: number
  author: string
  score: number
  text: string
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
}

export const LIVE_RANK_ONE_COMPONENTS: LiveScoreComponent[] = [
  { key: "recency", label: "Recency", raw_score: 0.971876150243864, weight: 0.25, weighted: 0.242969037560966 },
  { key: "engagement", label: "Engagement", raw_score: 0.45384361090898817, weight: 0.20, weighted: 0.09076872218179764 },
  { key: "bridging", label: "Bridging", raw_score: 0.9988304093567251, weight: 0.10, weighted: 0.09988304093567252 },
  { key: "source_diversity", label: "Source diversity", raw_score: 1, weight: 0.10, weighted: 0.1 },
  { key: "relevance", label: "Relevance", raw_score: 0.9, weight: 0.35, weighted: 0.315 },
]

export const LIVE_RANK_ONE_EXPLANATION = {
  receiptId: "production-receipt-rank-1",
  authorLabel: "Production receipt 001",
  text: "Public post text redacted; score structure preserved from the production receipt.",
  epochId: LIVE_METRICS_SNAPSHOT.epochId,
  totalScore: 0.8486208006784361,
  rank: 1,
  components: LIVE_RANK_ONE_COMPONENTS,
  counterfactual: {
    pureEngagementRank: 4,
    communityGovernedRank: 1,
    difference: 3,
  },
}

export const LIVE_FEED_POSTS: LiveFeedPostPreview[] = [
  {
    rank: 1,
    author: "Production receipt 001",
    score: 0.8486208006784361,
    text: "Public post text redacted; score structure preserved from the production receipt.",
  },
  {
    rank: 2,
    author: "Production receipt 002",
    score: 0.8447181456756023,
    text: "Public post text redacted; receipt categorized around AI terminology and LLMs.",
  },
  {
    rank: 3,
    author: "Production receipt 003",
    score: 0.8447074117364842,
    text: "Public post text redacted; receipt categorized around generative AI adoption.",
  },
  {
    rank: 4,
    author: "Production receipt 004",
    score: 0.8442263537240301,
    text: "Public post text redacted; receipt categorized around generative AI in games.",
  },
]

// Shared scoring model for the ranking replay.
//
// Both the full walkthrough on /how-it-works (HowItWorksReplay) and the compact
// teaser on the landing (ReplayTeaser) import their data and logic from here, so
// the two surfaces can never drift out of sync. This module is pure TypeScript
// (no JSX) so it can be imported by any component.

export type SignalKey = "recency" | "engagement" | "bridging" | "sourceDiversity" | "relevance"
export type EpochId = "engagement" | "bridge" | "field" | "freshness"
export type PostId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7"
export type PersonaId = "field-notes" | "dataset-maintainer" | "freshness-watcher" | "joke-enjoyer" | "bridge-builder"
export type SignalWeights = Record<SignalKey, number>

export interface Signal {
  readonly key: SignalKey
  readonly label: string
  readonly shortLabel: string
  readonly description: string
  readonly barColor: string
}

export interface DemoPost {
  readonly id: PostId
  readonly author: string
  readonly handle: string
  readonly time: string
  readonly avatarSrc: string
  readonly text: string
  readonly tags: readonly string[]
  readonly stats: {
    readonly replies: string
    readonly reposts: string
    readonly likes: string
  }
  readonly scores: SignalWeights
}

export interface Epoch {
  readonly id: EpochId
  readonly eyebrow: string
  readonly label: string
  readonly headline: string
  readonly body: string
  readonly weights: SignalWeights
}

export interface DemoPersona {
  readonly id: PersonaId
  readonly label: string
  readonly role: string
  readonly body: string
  readonly weights: SignalWeights
}

export interface RankedPost {
  readonly post: DemoPost
  readonly score: number
  readonly rank: number
}

export const signals: readonly Signal[] = [
  {
    key: "recency",
    label: "Recency",
    shortLabel: "Fresh",
    description: "How recently the post appeared.",
    barColor: "#6E93B8",
  },
  {
    key: "engagement",
    label: "Engagement",
    shortLabel: "Likes",
    description: "Replies, reposts, likes, and other public attention.",
    barColor: "#BC4B3E",
  },
  {
    key: "bridging",
    label: "Bridging",
    shortLabel: "Bridge",
    description: "How well the post connects subgroups inside the community.",
    barColor: "#9B6F94",
  },
  {
    key: "sourceDiversity",
    label: "Source diversity",
    shortLabel: "Diverse",
    description: "Whether the feed is hearing from a wider set of sources.",
    barColor: "#7A9A5E",
  },
  {
    key: "relevance",
    label: "Relevance",
    shortLabel: "Match",
    description: "How well the post matches the community's topic priorities.",
    barColor: "#C8612C",
  },
] as const

export const demoPosts: readonly DemoPost[] = [
  {
    id: "P1",
    author: "Maya Keene",
    handle: "@maya-keene.bsky.social",
    time: "14m",
    avatarSrc: "/images/avatars/maya-keene.png",
    text: "Mapped accessibility gaps in open transit data, then shared the notebook and cleaned CSV.",
    tags: ["open data", "accessibility", "transit"],
    scores: { recency: 0.72, engagement: 0.42, bridging: 0.92, sourceDiversity: 0.68, relevance: 0.9 },
    stats: { replies: "18", reposts: "42", likes: "164" },
  },
  {
    id: "P2",
    author: "Claire Rowan",
    handle: "@toastwindow.bsky.social",
    time: "6m",
    avatarSrc: "/images/avatars/claire-rowan.png",
    text: "A maintainer note on making privacy-preserving defaults easier to find in project docs.",
    tags: ["open source", "privacy", "documentation"],
    scores: { recency: 0.96, engagement: 0.35, bridging: 0.28, sourceDiversity: 0.55, relevance: 0.82 },
    stats: { replies: "9", reposts: "25", likes: "112" },
  },
  {
    id: "P3",
    author: "Arjun Mehta",
    handle: "@arjunmehta.dev",
    time: "31m",
    avatarSrc: "/images/avatars/arjun-mehta.png",
    text: "Found a timezone bug in our benchmark harness. Patch and before-and-after runs are in the thread.",
    tags: ["software", "reproducibility", "benchmarking"],
    scores: { recency: 0.64, engagement: 0.58, bridging: 0.22, sourceDiversity: 0.42, relevance: 0.48 },
    stats: { replies: "21", reposts: "36", likes: "208" },
  },
  {
    id: "P4",
    author: "Eli Moreno",
    handle: "@eli-overthinking.bsky.social",
    time: "18m",
    avatarSrc: "/images/avatars/eli-moreno.png",
    text: "Every open-source project has one file everyone is scared to touch.",
    tags: ["open source", "joke", "viral"],
    scores: { recency: 0.7, engagement: 0.95, bridging: 0.3, sourceDiversity: 0.35, relevance: 0.36 },
    stats: { replies: "86", reposts: "511", likes: "4.2K" },
  },
  {
    id: "P5",
    author: "Theo Kim",
    handle: "@thocknotes.bsky.social",
    time: "23m",
    avatarSrc: "/images/avatars/theo-kim.png",
    text: "Published a dataset comparing alt-text quality across image models, plus the scoring rubric.",
    tags: ["dataset", "accessibility", "machine learning"],
    scores: { recency: 0.68, engagement: 0.62, bridging: 0.88, sourceDiversity: 0.84, relevance: 0.94 },
    stats: { replies: "32", reposts: "96", likes: "340" },
  },
  {
    id: "P6",
    author: "Nina Valdez",
    handle: "@ninavaldez.bsky.social",
    time: "1h",
    avatarSrc: "/images/avatars/nina-valdez.png",
    text: "Field notes from a community mesh-network test, including the messy CSV and failed runs.",
    tags: ["community networks", "field notes", "data"],
    scores: { recency: 0.46, engagement: 0.28, bridging: 0.74, sourceDiversity: 0.72, relevance: 0.86 },
    stats: { replies: "7", reposts: "19", likes: "88" },
  },
  {
    id: "P7",
    author: "Leila Hart",
    handle: "@leilahart.bsky.social",
    time: "16m",
    avatarSrc: "/images/avatars/leila-hart.png",
    text: "The best research software is half methods section, half apology to future maintainers.",
    tags: ["research software", "methods", "culture"],
    scores: { recency: 0.75, engagement: 0.66, bridging: 0.7, sourceDiversity: 0.52, relevance: 0.76 },
    stats: { replies: "15", reposts: "54", likes: "261" },
  },
] as const

export const epochs: readonly Epoch[] = [
  {
    id: "engagement",
    eyebrow: "Epoch 07",
    label: "Conversation-heavy",
    headline: "Likes dominate the feed.",
    body: "This is the failure mode the community wants to fix: the viral joke wins even though it is a weak match.",
    weights: { recency: 0.05, engagement: 0.65, bridging: 0.05, sourceDiversity: 0.05, relevance: 0.2 },
  },
  {
    id: "bridge",
    eyebrow: "Epoch 08",
    label: "Bridge-building",
    headline: "The community boosts posts that connect subgroups.",
    body: "The policy rewards posts that carry useful context across both sides of the feed.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.35, sourceDiversity: 0.15, relevance: 0.25 },
  },
  {
    id: "field",
    eyebrow: "Epoch 09",
    label: "Research and tooling",
    headline: "Reusable work gets more room.",
    body: "The feed shifts toward relevance and source diversity so datasets, methods, and useful tooling do not vanish under jokes.",
    weights: { recency: 0.15, engagement: 0.1, bridging: 0.15, sourceDiversity: 0.3, relevance: 0.3 },
  },
  {
    id: "freshness",
    eyebrow: "Epoch 10",
    label: "Freshness push",
    headline: "Time-sensitive work rises.",
    body: "When the community cares about what is happening now, fresh releases and active conversations move up without making likes the whole policy.",
    weights: { recency: 0.55, engagement: 0.05, bridging: 0.05, sourceDiversity: 0.05, relevance: 0.3 },
  },
] as const

export const demoPersonas: readonly DemoPersona[] = [
  {
    id: "field-notes",
    label: "Research Steward",
    role: "Wants careful methods and useful context to survive the scroll.",
    body: "Boosts source-rich work and posts that match the community's research priorities.",
    weights: { recency: 0.18, engagement: 0.07, bridging: 0.14, sourceDiversity: 0.31, relevance: 0.3 },
  },
  {
    id: "dataset-maintainer",
    label: "Dataset Maintainer",
    role: "Cares about reproducible data, open tooling, and reusable context.",
    body: "Raises datasets, reproducible runs, useful tools, and well-labeled observations.",
    weights: { recency: 0.1, engagement: 0.06, bridging: 0.24, sourceDiversity: 0.28, relevance: 0.32 },
  },
  {
    id: "freshness-watcher",
    label: "Freshness Watcher",
    role: "Wants the feed to notice time-sensitive releases and conversations before they go stale.",
    body: "Pushes recency without letting generic virality take over the community.",
    weights: { recency: 0.52, engagement: 0.06, bridging: 0.08, sourceDiversity: 0.08, relevance: 0.26 },
  },
  {
    id: "joke-enjoyer",
    label: "Conversation Follower",
    role: "Values the culture and conversation posts too, as long as people can rebalance them.",
    body: "Gives engagement real weight so funny posts can win when the community chooses that.",
    weights: { recency: 0.13, engagement: 0.55, bridging: 0.08, sourceDiversity: 0.04, relevance: 0.2 },
  },
  {
    id: "bridge-builder",
    label: "Bridge Builder",
    role: "Wants posts that connect researchers, builders, data people, and open-network communities.",
    body: "Rewards posts that carry useful context across subgroups inside the feed.",
    weights: { recency: 0.12, engagement: 0.08, bridging: 0.42, sourceDiversity: 0.13, relevance: 0.25 },
  },
] as const

export const defaultPersonaIds: readonly PersonaId[] = ["field-notes", "dataset-maintainer", "bridge-builder"] as const

export function normalizeWeights(weights: SignalWeights): SignalWeights {
  const total = signals.reduce((sum, signal) => {
    const value = weights[signal.key]
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid weight for ${signal.key}: ${String(value)}`)
    }
    return sum + value
  }, 0)

  if (total <= 0) {
    throw new Error("Cannot normalize empty signal weights")
  }

  return Object.fromEntries(
    signals.map((signal) => [signal.key, weights[signal.key] / total]),
  ) as SignalWeights
}

export function getPersonaById(personaId: PersonaId): DemoPersona {
  const persona = demoPersonas.find((candidate) => candidate.id === personaId)

  if (persona === undefined) {
    throw new Error(`Unknown persona id: ${personaId}`)
  }

  return persona
}

export function aggregatePersonaWeights(personaIds: readonly PersonaId[]): SignalWeights {
  if (personaIds.length === 0) {
    throw new Error("At least one persona is required to aggregate demo weights")
  }

  const totals = Object.fromEntries(signals.map((signal) => [signal.key, 0])) as SignalWeights

  for (const personaId of personaIds) {
    const persona = getPersonaById(personaId)

    for (const signal of signals) {
      totals[signal.key] += persona.weights[signal.key]
    }
  }

  return normalizeWeights(totals)
}

export function scorePostWithWeights(post: DemoPost, weights: SignalWeights): number {
  return signals.reduce((total, signal) => {
    return total + post.scores[signal.key] * weights[signal.key]
  }, 0)
}

export function scorePost(post: DemoPost, epoch: Epoch): number {
  return scorePostWithWeights(post, epoch.weights)
}

export function rankPostsForWeights(weights: SignalWeights): RankedPost[] {
  return demoPosts
    .map((post) => ({
      post,
      score: scorePostWithWeights(post, weights),
    }))
    .sort((left, right) => right.score - left.score)
    .map((rankedPost, index) => ({
      ...rankedPost,
      rank: index + 1,
    }))
}

export function rankPosts(epoch: Epoch): RankedPost[] {
  return rankPostsForWeights(epoch.weights)
}

export function getEpochById(epochId: EpochId): Epoch {
  const epoch = epochs.find((candidate) => candidate.id === epochId)

  if (epoch === undefined) {
    throw new Error(`Unknown epoch id: ${epochId}`)
  }

  return epoch
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatScore(value: number): string {
  return value.toFixed(3)
}

export function getTopPostId(epochId: EpochId): PostId {
  const topPost = rankPosts(getEpochById(epochId))[0]

  if (topPost === undefined) {
    throw new Error(`No ranked posts for epoch: ${epochId}`)
  }

  return topPost.post.id
}

export function getTopPostIdForWeights(weights: SignalWeights): PostId {
  const topPost = rankPostsForWeights(weights)[0]

  if (topPost === undefined) {
    throw new Error("No ranked posts for demo weights")
  }

  return topPost.post.id
}

export function movementLabel(currentRank: number, previousRank: number | undefined): string | null {
  if (previousRank === undefined) {
    return null
  }

  if (previousRank === currentRank) {
    return "held rank"
  }

  if (previousRank > currentRank) {
    return `up from #${previousRank}`
  }

  return `down from #${previousRank}`
}

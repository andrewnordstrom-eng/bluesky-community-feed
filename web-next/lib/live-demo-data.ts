const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? ""
const BLUESKY_APPVIEW_BASE_URL = "https://public.api.bsky.app"
const LIVE_FEED_LIMIT = 4
const REQUEST_TIMEOUT_MS = 12_000

export const CORGI_COMMUNITY_FEED_URI =
  "at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov"

export interface LiveDemoWeights {
  readonly epochId: number
  readonly status: string
  readonly voteCount: number
  readonly createdAt: string
  readonly weights: {
    readonly recency: number
    readonly engagement: number
    readonly bridging: number
    readonly source_diversity: number
    readonly relevance: number
  }
}

export interface LiveDemoStats {
  readonly epochId: number
  readonly totalPostsScored: number
  readonly uniqueAuthors: number
  readonly avgBridging: number
  readonly avgEngagement: number
  readonly medianBridging: number
  readonly medianTotal: number
  readonly votesThisEpoch: number
}

export interface LiveDemoFeedPost {
  readonly rank: number
  readonly uri: string
  readonly bskyUrl: string
  readonly authorHandle: string
  readonly authorDisplayName: string
  readonly text: string
  readonly indexedAt: string | null
  readonly likeCount: number | null
  readonly repostCount: number | null
  readonly replyCount: number | null
  readonly score: number | null
}

export interface LiveDemoScoreComponent {
  readonly key: string
  readonly label: string
  readonly raw_score: number
  readonly weight: number
  readonly weighted: number
}

export interface LiveDemoTopicBreakdown {
  readonly slug: string
  readonly name: string
  readonly postScore: number
  readonly communityWeight: number
  readonly contribution: number
}

export interface LiveDemoExplanation {
  readonly postUri: string
  readonly epochId: number
  readonly totalScore: number
  readonly rank: number
  readonly components: readonly LiveDemoScoreComponent[]
  readonly counterfactual: {
    readonly pureEngagementRank: number
    readonly communityGovernedRank: number
    readonly difference: number
  }
  readonly scoredAt: string
  readonly topicBreakdown: readonly LiveDemoTopicBreakdown[]
}

export interface LiveDemoData {
  readonly fetchedAt: string
  readonly feedCursor: string | null
  readonly posts: readonly LiveDemoFeedPost[]
  readonly weights: LiveDemoWeights | null
  readonly stats: LiveDemoStats | null
  readonly explanation: LiveDemoExplanation | null
  readonly errors: readonly string[]
}

export class LiveDemoDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LiveDemoDataError"
  }
}

interface FeedSkeletonResponse {
  readonly feed?: readonly { readonly post?: unknown }[]
  readonly cursor?: unknown
}

interface GovernanceWeightsResponse {
  readonly epoch_id?: unknown
  readonly status?: unknown
  readonly vote_count?: unknown
  readonly created_at?: unknown
  readonly weights?: {
    readonly recency?: unknown
    readonly engagement?: unknown
    readonly bridging?: unknown
    readonly sourceDiversity?: unknown
    readonly source_diversity?: unknown
    readonly relevance?: unknown
  }
}

interface FeedStatsResponse {
  readonly epoch?: {
    readonly id?: unknown
  }
  readonly feed_stats?: {
    readonly total_posts_scored?: unknown
    readonly unique_authors?: unknown
    readonly avg_bridging_score?: unknown
    readonly avg_engagement_score?: unknown
    readonly median_bridging_score?: unknown
    readonly median_total_score?: unknown
  }
  readonly governance?: {
    readonly votes_this_epoch?: unknown
  }
}

interface HydratedPostResponse {
  readonly posts?: readonly HydratedPostApi[]
}

interface HydratedPostApi {
  readonly uri?: unknown
  readonly author?: {
    readonly handle?: unknown
    readonly displayName?: unknown
  }
  readonly record?: {
    readonly text?: unknown
  }
  readonly indexedAt?: unknown
  readonly likeCount?: unknown
  readonly repostCount?: unknown
  readonly replyCount?: unknown
}

interface ScoreComponentApi {
  readonly raw_score?: unknown
  readonly weight?: unknown
  readonly weighted?: unknown
}

interface RelevanceScoreComponentApi extends ScoreComponentApi {
  readonly topicBreakdown?: Record<string, TopicBreakdownApi>
}

interface TopicBreakdownApi {
  readonly postScore?: unknown
  readonly communityWeight?: unknown
  readonly contribution?: unknown
}

interface PostExplanationResponse {
  readonly post_uri?: unknown
  readonly epoch_id?: unknown
  readonly total_score?: unknown
  readonly rank?: unknown
  readonly components?: {
    readonly recency?: ScoreComponentApi
    readonly engagement?: ScoreComponentApi
    readonly bridging?: ScoreComponentApi
    readonly source_diversity?: ScoreComponentApi
    readonly relevance?: RelevanceScoreComponentApi
  }
  readonly counterfactual?: {
    readonly pure_engagement_rank?: unknown
    readonly community_governed_rank?: unknown
    readonly difference?: unknown
  }
  readonly scored_at?: unknown
}

const SCORE_COMPONENTS = [
  { key: "recency", label: "Recency" },
  { key: "engagement", label: "Engagement" },
  { key: "bridging", label: "Bridging" },
  { key: "source_diversity", label: "Source diversity" },
  { key: "relevance", label: "Relevance" },
] as const

function buildCorgiUrl(path: string): string {
  if (API_BASE_URL.length === 0) {
    return path
  }

  return new URL(path, API_BASE_URL).toString()
}

export function buildPostHydrationUrl(postUris: readonly string[]): string {
  const url = new URL("/xrpc/app.bsky.feed.getPosts", BLUESKY_APPVIEW_BASE_URL)

  for (const postUri of postUris) {
    url.searchParams.append("uris", postUri)
  }

  return url.toString()
}

export function bskyPostUrlFromAtUri(postUri: string): string {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(postUri)

  if (match === null) {
    throw new LiveDemoDataError(`Unable to build Bluesky URL from post URI: ${postUri}`)
  }

  const repo = match[1]
  const rkey = match[2]

  if (repo === undefined || rkey === undefined) {
    throw new LiveDemoDataError(`Unable to parse Bluesky post URI: ${postUri}`)
  }

  return `https://bsky.app/profile/${repo}/post/${rkey}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function asString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new LiveDemoDataError(`Expected ${field} to be a non-empty string`)
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  throw new LiveDemoDataError(`Expected ${field} to be a finite number`)
}

function asOptionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return asNumber(value, field)
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function createTimedSignal(
  parentSignal: AbortSignal,
  timeoutMs: number,
  context: string,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController()
  const timeoutId: ReturnType<typeof globalThis.setTimeout> = globalThis.setTimeout(() => {
    controller.abort(new LiveDemoDataError(`${context} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const abortFromParent = (): void => {
    controller.abort(parentSignal.reason)
  }

  if (parentSignal.aborted) {
    abortFromParent()
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timeoutId)
      parentSignal.removeEventListener("abort", abortFromParent)
    },
  }
}

async function fetchJson<TResponse>(
  url: string,
  signal: AbortSignal,
  context: string,
): Promise<TResponse> {
  const timedSignal = createTimedSignal(signal, REQUEST_TIMEOUT_MS, context)

  try {
    const response = await fetch(url, {
      signal: timedSignal.signal,
      headers: {
        Accept: "application/json",
      },
    })
    const body = await response.text()

    if (!response.ok) {
      throw new LiveDemoDataError(
        `${context} failed with HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      )
    }

    try {
      return JSON.parse(body) as TResponse
    } catch (error) {
      throw new LiveDemoDataError(`${context} returned invalid JSON: ${errorMessage(error)}`)
    }
  } catch (error) {
    if (error instanceof LiveDemoDataError) {
      throw error
    }

    if (timedSignal.signal.aborted && timedSignal.signal.reason instanceof Error) {
      throw new LiveDemoDataError(`${context} aborted: ${timedSignal.signal.reason.message}`)
    }

    throw new LiveDemoDataError(`${context} request failed: ${errorMessage(error)}`)
  } finally {
    timedSignal.dispose()
  }
}

function normalizeFeedSkeleton(response: FeedSkeletonResponse): {
  readonly postUris: readonly string[]
  readonly cursor: string | null
} {
  if (!Array.isArray(response.feed)) {
    throw new LiveDemoDataError("Corgi feed skeleton response did not include a feed array")
  }

  const postUris = response.feed.map((item, index) =>
    asString(item.post, `feed[${index}].post`),
  )

  return {
    postUris,
    cursor: typeof response.cursor === "string" && response.cursor.length > 0 ? response.cursor : null,
  }
}

function normalizeWeights(response: GovernanceWeightsResponse): LiveDemoWeights {
  const weights = response.weights

  if (weights === undefined) {
    throw new LiveDemoDataError("Governance weights response did not include weights")
  }

  return {
    epochId: asNumber(response.epoch_id, "weights.epoch_id"),
    status: asString(response.status, "weights.status"),
    voteCount: asNumber(response.vote_count, "weights.vote_count"),
    createdAt: asString(response.created_at, "weights.created_at"),
    weights: {
      recency: asNumber(weights.recency, "weights.recency"),
      engagement: asNumber(weights.engagement, "weights.engagement"),
      bridging: asNumber(weights.bridging, "weights.bridging"),
      source_diversity: asNumber(
        weights.sourceDiversity ?? weights.source_diversity,
        "weights.source_diversity",
      ),
      relevance: asNumber(weights.relevance, "weights.relevance"),
    },
  }
}

function normalizeStats(response: FeedStatsResponse): LiveDemoStats {
  if (response.epoch === undefined || response.feed_stats === undefined || response.governance === undefined) {
    throw new LiveDemoDataError("Transparency stats response did not include epoch, feed_stats, and governance")
  }

  return {
    epochId: asNumber(response.epoch.id, "stats.epoch.id"),
    totalPostsScored: asNumber(response.feed_stats.total_posts_scored, "stats.feed_stats.total_posts_scored"),
    uniqueAuthors: asNumber(response.feed_stats.unique_authors, "stats.feed_stats.unique_authors"),
    avgBridging: asNumber(response.feed_stats.avg_bridging_score, "stats.feed_stats.avg_bridging_score"),
    avgEngagement: asNumber(response.feed_stats.avg_engagement_score, "stats.feed_stats.avg_engagement_score"),
    medianBridging: asNumber(response.feed_stats.median_bridging_score, "stats.feed_stats.median_bridging_score"),
    medianTotal: asNumber(response.feed_stats.median_total_score, "stats.feed_stats.median_total_score"),
    votesThisEpoch: asNumber(response.governance.votes_this_epoch, "stats.governance.votes_this_epoch"),
  }
}

function normalizeHydratedPosts(
  response: HydratedPostResponse,
  postUris: readonly string[],
  explanation: LiveDemoExplanation | null,
): readonly LiveDemoFeedPost[] {
  if (!Array.isArray(response.posts)) {
    throw new LiveDemoDataError("Bluesky AppView response did not include a posts array")
  }

  const rankByUri = new Map(postUris.map((postUri, index) => [postUri, index + 1]))

  return response.posts.map((post) => {
    const uri = asString(post.uri, "post.uri")
    const rank = rankByUri.get(uri)

    if (rank === undefined) {
      throw new LiveDemoDataError(`Bluesky AppView returned an unexpected post URI: ${uri}`)
    }

    return {
      rank,
      uri,
      bskyUrl: bskyPostUrlFromAtUri(uri),
      authorHandle: asString(post.author?.handle, `post ${uri} author.handle`),
      authorDisplayName:
        typeof post.author?.displayName === "string" && post.author.displayName.length > 0
          ? post.author.displayName
          : asString(post.author?.handle, `post ${uri} author.handle`),
      text:
        typeof post.record?.text === "string" && post.record.text.length > 0
          ? post.record.text
          : "Post text unavailable from Bluesky AppView.",
      indexedAt: typeof post.indexedAt === "string" && post.indexedAt.length > 0 ? post.indexedAt : null,
      likeCount: asOptionalNumber(post.likeCount, `post ${uri} likeCount`),
      repostCount: asOptionalNumber(post.repostCount, `post ${uri} repostCount`),
      replyCount: asOptionalNumber(post.replyCount, `post ${uri} replyCount`),
      score: explanation?.postUri === uri ? explanation.totalScore : null,
    }
  }).sort((left, right) => left.rank - right.rank)
}

export function scoreComponentsFromExplanation(
  response: PostExplanationResponse,
): readonly LiveDemoScoreComponent[] {
  if (response.components === undefined) {
    throw new LiveDemoDataError("Post explanation response did not include components")
  }

  return SCORE_COMPONENTS.map((component) => {
    const apiComponent = response.components?.[component.key]

    if (apiComponent === undefined) {
      throw new LiveDemoDataError(`Post explanation response omitted ${component.key} component`)
    }

    return {
      key: component.key,
      label: component.label,
      raw_score: asNumber(apiComponent.raw_score, `explanation.components.${component.key}.raw_score`),
      weight: asNumber(apiComponent.weight, `explanation.components.${component.key}.weight`),
      weighted: asNumber(apiComponent.weighted, `explanation.components.${component.key}.weighted`),
    }
  })
}

export function topicBreakdownFromExplanation(
  response: PostExplanationResponse,
): readonly LiveDemoTopicBreakdown[] {
  const breakdown = response.components?.relevance?.topicBreakdown

  if (breakdown === undefined) {
    return []
  }

  return Object.entries(breakdown)
    .map(([slug, topic]) => ({
      slug,
      name: humanizeSlug(slug),
      postScore: asNumber(topic.postScore, `topic ${slug} postScore`),
      communityWeight: asNumber(topic.communityWeight, `topic ${slug} communityWeight`),
      contribution: asNumber(topic.contribution, `topic ${slug} contribution`),
    }))
    .sort((left, right) => right.contribution - left.contribution)
}

function normalizeExplanation(response: PostExplanationResponse): LiveDemoExplanation {
  if (response.counterfactual === undefined) {
    throw new LiveDemoDataError("Post explanation response did not include counterfactual")
  }

  return {
    postUri: asString(response.post_uri, "explanation.post_uri"),
    epochId: asNumber(response.epoch_id, "explanation.epoch_id"),
    totalScore: asNumber(response.total_score, "explanation.total_score"),
    rank: asNumber(response.rank, "explanation.rank"),
    components: scoreComponentsFromExplanation(response),
    counterfactual: {
      pureEngagementRank: asNumber(
        response.counterfactual.pure_engagement_rank,
        "explanation.counterfactual.pure_engagement_rank",
      ),
      communityGovernedRank: asNumber(
        response.counterfactual.community_governed_rank,
        "explanation.counterfactual.community_governed_rank",
      ),
      difference: asNumber(response.counterfactual.difference, "explanation.counterfactual.difference"),
    },
    scoredAt: asString(response.scored_at, "explanation.scored_at"),
    topicBreakdown: topicBreakdownFromExplanation(response),
  }
}

async function fetchFeedSkeleton(signal: AbortSignal): Promise<{
  readonly postUris: readonly string[]
  readonly cursor: string | null
}> {
  const url = new URL(buildCorgiUrl("/xrpc/app.bsky.feed.getFeedSkeleton"), window.location.origin)
  url.searchParams.set("feed", CORGI_COMMUNITY_FEED_URI)
  url.searchParams.set("limit", String(LIVE_FEED_LIMIT))
  const response = await fetchJson<FeedSkeletonResponse>(url.toString(), signal, "Corgi feed skeleton")
  return normalizeFeedSkeleton(response)
}

async function fetchWeights(signal: AbortSignal): Promise<LiveDemoWeights> {
  const response = await fetchJson<GovernanceWeightsResponse>(
    buildCorgiUrl("/api/governance/weights"),
    signal,
    "Corgi governance weights",
  )
  return normalizeWeights(response)
}

async function fetchStats(signal: AbortSignal): Promise<LiveDemoStats> {
  const response = await fetchJson<FeedStatsResponse>(
    buildCorgiUrl("/api/transparency/stats"),
    signal,
    "Corgi transparency stats",
  )
  return normalizeStats(response)
}

async function fetchExplanation(postUri: string, signal: AbortSignal): Promise<LiveDemoExplanation> {
  const response = await fetchJson<PostExplanationResponse>(
    buildCorgiUrl(`/api/transparency/post/${encodeURIComponent(postUri)}`),
    signal,
    "Corgi post explanation",
  )
  return normalizeExplanation(response)
}

async function fetchHydratedPosts(
  postUris: readonly string[],
  explanation: LiveDemoExplanation | null,
  signal: AbortSignal,
): Promise<readonly LiveDemoFeedPost[]> {
  const response = await fetchJson<HydratedPostResponse>(
    buildPostHydrationUrl(postUris),
    signal,
    "Bluesky AppView post hydration",
  )
  return normalizeHydratedPosts(response, postUris, explanation)
}

export async function fetchLiveDemoData(signal: AbortSignal): Promise<LiveDemoData> {
  const [feedResult, weightsResult, statsResult] = await Promise.allSettled([
    fetchFeedSkeleton(signal),
    fetchWeights(signal),
    fetchStats(signal),
  ])
  const errors: string[] = []

  if (weightsResult.status === "rejected") {
    errors.push(errorMessage(weightsResult.reason))
  }

  if (statsResult.status === "rejected") {
    errors.push(errorMessage(statsResult.reason))
  }

  if (feedResult.status === "rejected") {
    errors.push(errorMessage(feedResult.reason))
    return {
      fetchedAt: new Date().toISOString(),
      feedCursor: null,
      posts: [],
      weights: weightsResult.status === "fulfilled" ? weightsResult.value : null,
      stats: statsResult.status === "fulfilled" ? statsResult.value : null,
      explanation: null,
      errors,
    }
  }

  const topPostUri = feedResult.value.postUris[0]

  if (topPostUri === undefined) {
    errors.push("Corgi feed skeleton returned no posts")
    return {
      fetchedAt: new Date().toISOString(),
      feedCursor: feedResult.value.cursor,
      posts: [],
      weights: weightsResult.status === "fulfilled" ? weightsResult.value : null,
      stats: statsResult.status === "fulfilled" ? statsResult.value : null,
      explanation: null,
      errors,
    }
  }

  const explanationResult = await Promise.allSettled([fetchExplanation(topPostUri, signal)])
  const explanation =
    explanationResult[0]?.status === "fulfilled" ? explanationResult[0].value : null

  if (explanationResult[0]?.status === "rejected") {
    errors.push(errorMessage(explanationResult[0].reason))
  }

  const postsResult = await Promise.allSettled([
    fetchHydratedPosts(feedResult.value.postUris, explanation, signal),
  ])
  const posts = postsResult[0]?.status === "fulfilled" ? postsResult[0].value : []

  if (postsResult[0]?.status === "rejected") {
    errors.push(errorMessage(postsResult[0].reason))
  }

  return {
    fetchedAt: new Date().toISOString(),
    feedCursor: feedResult.value.cursor,
    posts,
    weights: weightsResult.status === "fulfilled" ? weightsResult.value : null,
    stats: statsResult.status === "fulfilled" ? statsResult.value : null,
    explanation,
    errors,
  }
}

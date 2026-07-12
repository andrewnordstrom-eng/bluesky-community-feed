import { z } from "zod"

export const CONTRACT_VERSION = "2026-07-11.shadow-demo.v4" as const

const signalKeySchema = z.enum(["recency", "engagement", "bridging", "source_diversity", "relevance"])
const topicKeySchema = z.string().min(1).max(64)
const communityIdSchema = z.literal("community_gov")
const voterBlocIdSchema = z.enum([
  "freshness_watcher",
  "conversation_follower",
  "bridge_builder",
  "source_diversifier",
  "relevance_steward",
])
const voterBlocIdPattern = voterBlocIdSchema.options.join("|")
const syntheticVoterIdPattern = new RegExp(`^synthetic-(${voterBlocIdPattern})-\\d+$`)

const finiteNumber = z.number().finite()
const nonNegativeNumber = finiteNumber.nonnegative()
const unitNumber = finiteNumber.min(0).max(1)
const isoDateTime = z.string().datetime({ offset: true })

export const apiWeightsSchema = z.object({
  recency: unitNumber,
  engagement: unitNumber,
  bridging: unitNumber,
  source_diversity: unitNumber,
  relevance: unitNumber,
}).strict()

const apiTopicWeightsSchema = z.record(z.string().min(1).max(64), unitNumber)
  .refine((weights) => Object.keys(weights).length <= 64, {
    message: "Topic policy exceeds the supported 64-key response bound",
  })

export const apiTopicIntentSchema = z.object({
  topicWeights: apiTopicWeightsSchema,
}).strict()

const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "degraded"]),
}).strict()

const contentRuleSupportSchema = z.object({
  keyword: z.string().min(1).max(50),
  supportCount: z.number().int().nonnegative(),
  adopted: z.boolean(),
}).strict()

const contentRulesSummarySchema = z.object({
  enabled: z.literal(true),
  threshold: z.number().int().positive(),
  electorate: z.number().int().nonnegative(),
  adoptedExcludeKeywords: z.array(z.string().min(1).max(50)),
  support: z.array(contentRuleSupportSchema),
}).strict()

const suggestedExcludeKeywordSchema = z.object({
  keyword: z.string().min(1).max(50),
  matchCount: z.number().int().nonnegative(),
}).strict()

const voteSummarySchema = z.object({
  aggregateMethod: z.literal("trimmed_mean_no_trim_under_10"),
  voteCount: z.number().int().nonnegative(),
  trimCount: z.number().int().nonnegative(),
  weights: apiWeightsSchema,
  topicIntent: apiTopicIntentSchema,
  contentRules: contentRulesSummarySchema.optional(),
}).strict()

const epochSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  label: z.string().min(1),
  status: z.enum(["open", "advanced"]),
  createdAt: isoDateTime,
  advancedAt: isoDateTime.nullable(),
  decidedByEpochId: z.string().min(1).nullable(),
  aggregate: voteSummarySchema,
}).strict()

const voteBaseSchema = z.object({
  id: z.string().min(1),
  epochId: z.string().min(1),
  label: z.string().min(1),
  weights: apiWeightsSchema,
  topicIntent: apiTopicIntentSchema,
  excludeKeywords: z.array(z.string().min(1).max(50)).max(10).optional(),
  createdAt: isoDateTime,
})

const reviewerVoteSchema = voteBaseSchema.extend({
  actorType: z.literal("reviewer"),
  actorId: z.literal("reviewer"),
}).strict()

export const apiSyntheticVoteSchema = voteBaseSchema.extend({
  actorType: z.literal("synthetic_voter"),
  actorId: z.string().regex(syntheticVoterIdPattern),
  blocId: voterBlocIdSchema,
}).strict().superRefine((vote, context) => {
  const actorBloc = vote.actorId.match(syntheticVoterIdPattern)?.[1]
  if (actorBloc !== vote.blocId) {
    context.addIssue({
      code: "custom",
      message: "Synthetic voter actorId must identify the declared blocId.",
      path: ["blocId"],
    })
  }
})

const corpusHealthSchema = z.object({
  status: z.enum(["live", "degraded"]),
  source: z.enum(["production_scores_appview", "production_feed_snapshot", "fixture_fallback"]),
  candidatePosts72h: z.number().int().nonnegative(),
  publicScoredPosts: z.number().int().nonnegative(),
  uniqueAuthors72h: z.number().int().nonnegative(),
  bridgePostShare: unitNumber,
  topAuthorConcentration: unitNumber,
  sampledAt: isoDateTime,
  sourcePostCount: z.number().int().nonnegative().optional(),
  eligiblePostCount: z.number().int().nonnegative().optional(),
  englishTaggedShare: unitNumber.optional(),
  richMediaShare: unitNumber.optional(),
}).strict()

export const apiReceiptComponentsSchema = z.array(z.object({
  signal: signalKeySchema,
  rawScore: finiteNumber,
  weight: unitNumber,
  contribution: finiteNumber,
}).strict()).length(5).refine(
  (components) => new Set(components.map((component) => component.signal)).size === 5,
  { message: "Receipt must contain one component for each ranking signal." },
)

const corpusProvenanceBaseShape = {
  description: z.string().min(1),
  corpusId: z.string().min(1),
  productionEpochId: z.number().int().nonnegative(),
  sampledAt: isoDateTime,
  windowHours: nonNegativeNumber,
  topicScoreThreshold: unitNumber,
  eligiblePostCount: z.number().int().nonnegative(),
} as const
const snapshotCorpusProvenanceSchema = z.object({
  ...corpusProvenanceBaseShape,
  mode: z.literal("production_feed_snapshot_session_frozen"),
  label: z.literal("Reviewer-safe snapshot of the live Community Governed Feed"),
  sourceFeedUri: z.string().startsWith("at://"),
  sourceFeedName: z.string().min(1),
  sourceSnapshotDigest: z.string().min(1),
  sourceRunId: z.string().min(1),
  sourceUpdatedAt: isoDateTime,
  sourceReviewedAt: isoDateTime.optional(),
  sourcePostCount: z.number().int().nonnegative(),
  selectionPolicyVersion: z.string().min(1),
  baselineOrderDigest: z.string().min(1),
}).strict()
const liveCorpusProvenanceSchema = z.object({
  ...corpusProvenanceBaseShape,
  mode: z.literal("production_sourced_session_frozen"),
  label: z.literal("Live-scored snapshot"),
}).strict()
const fixtureCorpusProvenanceSchema = z.object({
  ...corpusProvenanceBaseShape,
  mode: z.literal("illustrative_fixture_session_frozen"),
  label: z.literal("Illustrative mechanics fixture"),
}).strict()
const corpusProvenanceSchema = z.discriminatedUnion("mode", [
  snapshotCorpusProvenanceSchema,
  liveCorpusProvenanceSchema,
  fixtureCorpusProvenanceSchema,
])
const receiptProvenanceShape = {
  shadowEpochId: z.string().min(1),
  postInclusionReasons: z.object({
    matchedTopics: z.array(z.object({ topic: topicKeySchema, score: finiteNumber }).strict()),
    matchedTerms: z.array(z.string().min(1)),
    sourceRank: z.number().int().positive().optional(),
    reason: z.literal("published_feed_snapshot").optional(),
  }).strict(),
} as const
const receiptProvenanceSchema = z.discriminatedUnion("mode", [
  snapshotCorpusProvenanceSchema.extend(receiptProvenanceShape).strict(),
  liveCorpusProvenanceSchema.extend(receiptProvenanceShape).strict(),
  fixtureCorpusProvenanceSchema.extend(receiptProvenanceShape).strict(),
])

const topicCatalogEntrySchema = z.object({
  slug: topicKeySchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  baselineWeight: unitNumber,
}).strict()

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "Expected an HTTPS URL",
})

const imageMediaSchema = z.object({
  thumb: httpsUrl,
  fullsize: httpsUrl,
  alt: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
}).strict()

const externalMediaSchema = z.object({
  uri: httpsUrl,
  title: z.string(),
  description: z.string(),
  thumb: httpsUrl.nullable(),
}).strict()

const quoteMediaSchema = z.object({
  uri: z.string().startsWith("at://"),
  authorHandle: z.string().min(1),
  authorDisplayName: z.string().min(1),
  text: z.string().min(1),
}).strict()

const videoMediaSchema = z.object({
  thumbnail: httpsUrl.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
}).strict()

export const apiPostMediaSchema = z.object({
  images: z.array(imageMediaSchema),
  external: externalMediaSchema.nullable(),
  quote: quoteMediaSchema.nullable(),
  video: videoMediaSchema.nullable(),
}).strict()

const communitySchema = z.object({
  id: communityIdSchema,
  name: z.string().min(1),
  status: z.enum(["live_shadow", "degraded"]),
  description: z.string().min(1),
  liveFeedReady: z.boolean(),
}).strict()

const voterProfileSchema = z.object({
  id: voterBlocIdSchema,
  label: z.string().min(1),
  voterCount: z.number().int().positive(),
  baseWeights: apiWeightsSchema,
  baseTopicWeights: apiTopicIntentSchema.shape.topicWeights,
  reviewerBlend: unitNumber,
  policyInertia: unitNumber,
}).strict()

export const apiSessionPayloadSchema = z.object({
  session: z.object({
    sessionId: z.string().min(1),
    community: communitySchema,
    phase: z.enum(["created", "reviewer_voted", "synthetic_voters_ran", "epoch_advanced"]),
    currentEpochId: z.string().min(1),
    expiresAt: isoDateTime,
    corpusHealth: corpusHealthSchema,
    epochs: z.array(epochSchema).min(1),
    pendingAggregate: voteSummarySchema.nullable(),
    voteCount: z.number().int().nonnegative(),
    guidedEpochs: z.literal(5),
    maxEpochs: z.literal(10),
    syntheticVoterCount: z.literal(24),
    totalDemoVoters: z.literal(25),
    corpusProvenance: corpusProvenanceSchema,
    topicCatalog: z.array(topicCatalogEntrySchema).length(26).refine(
      (catalog) => new Set(catalog.map((topic) => topic.slug)).size === 26,
      { message: "Community Governed Feed topic catalog must contain 26 unique active topics." },
    ),
    sourceFeedUri: z.string().startsWith("at://"),
    voterProfiles: z.array(voterProfileSchema),
    votes: z.array(z.union([reviewerVoteSchema, apiSyntheticVoteSchema])),
    contentRulesEnabled: z.literal(true).optional(),
    suggestedExcludeKeywords: z.array(suggestedExcludeKeywordSchema).optional(),
  }).strict(),
}).strict()

const publicPostSchema = z.object({
  kind: z.literal("public_post"),
  uri: z.string().startsWith("at://"),
  cid: z.string().min(1),
  authorDid: z.string().startsWith("did:"),
  authorHandle: z.string().min(1),
  authorDisplayName: z.string().min(1),
  authorAvatar: z.string().url().nullable(),
  text: z.string().min(1),
  likeCount: z.number().int().nonnegative(),
  repostCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  quoteCount: z.number().int().nonnegative(),
  indexedAt: isoDateTime,
  createdAt: isoDateTime,
  bskyUrl: z.string().url(),
  languages: z.array(z.string().min(1).max(35)).optional(),
  media: apiPostMediaSchema.nullable().optional(),
}).strict()

const hiddenPostSchema = z.object({
  kind: z.literal("hidden_post"),
  reason: z.string().min(1),
}).strict()

const rawScoresSchema = z.object({
  recency: finiteNumber,
  engagement: finiteNumber,
  bridging: finiteNumber,
  source_diversity: finiteNumber,
  relevance: finiteNumber,
}).strict()

const withheldPostSchema = z.object({
  keyword: z.string().min(1).max(50),
  supportCount: z.number().int().nonnegative(),
  previousRank: z.number().int().positive().nullable(),
  post: z.discriminatedUnion("kind", [publicPostSchema, hiddenPostSchema]),
}).strict()

export const apiFeedPayloadSchema = z.object({
  epochId: z.string().min(1),
  corpusId: z.string().min(1),
  communityId: communityIdSchema,
  corpusHealth: corpusHealthSchema,
  corpusProvenance: corpusProvenanceSchema,
  aggregate: voteSummarySchema,
  posts: z.array(z.object({
    rank: z.number().int().positive(),
    previousRank: z.number().int().positive().nullable(),
    movement: z.number().int().nullable(),
    score: finiteNumber.nullable(),
    weightedComponents: rawScoresSchema.nullable(),
    rawScores: rawScoresSchema.nullable(),
    post: z.discriminatedUnion("kind", [publicPostSchema, hiddenPostSchema]),
    publishedRank: z.number().int().positive().optional(),
    publishedScore: finiteNumber.optional(),
    componentScore: finiteNumber.nullable().optional(),
    publicationAdjustment: finiteNumber.nullable().optional(),
  }).strict()),
  withheldPosts: z.array(withheldPostSchema).optional(),
}).strict()

export const apiReceiptPayloadSchema = z.object({
  receipt: z.object({
    type: z.literal("shadow_demo_receipt"),
    epochId: z.string().min(1),
    postUri: z.string().startsWith("at://"),
    visibleRank: z.number().int().positive(),
    previousRank: z.number().int().positive().nullable(),
    score: finiteNumber,
    componentScore: finiteNumber.optional(),
    publicationAdjustment: finiteNumber.optional(),
    publishedRank: z.number().int().positive().optional(),
    publishedScore: finiteNumber.optional(),
    scoredAt: isoDateTime,
    aggregate: voteSummarySchema,
    reviewerBallotShare: unitNumber,
    components: apiReceiptComponentsSchema,
    topicRelevanceFormula: z.object({
      formulaApplied: z.boolean(),
      defaultTopicWeight: unitNumber,
      confidenceThreshold: nonNegativeNumber,
      weightedSum: finiteNumber.nullable(),
      signalSum: finiteNumber.nullable(),
      baseRelevance: finiteNumber,
      confidenceMultiplier: nonNegativeNumber,
      effectiveRelevance: finiteNumber,
      usedDefaultWeight: z.boolean(),
      terms: z.array(z.object({
        topic: z.string().min(1),
        postScore: finiteNumber,
        communityWeight: unitNumber,
        weightedTerm: finiteNumber,
        usedDefaultWeight: z.boolean(),
      }).strict()),
    }).strict(),
    provenance: receiptProvenanceSchema,
    counterfactuals: z.array(z.object({
      label: z.enum(["previous_epoch", "engagement_only", "direct_reviewer_ballot_removed"]),
      description: z.string().min(1),
      rank: z.number().int().positive().nullable(),
      deltaFromVisible: z.number().int().nullable(),
    }).strict()),
    contentRules: z.object({
      adoptedExcludeKeywords: z.array(z.string().min(1).max(50)),
      threshold: z.number().int().positive(),
      electorate: z.number().int().nonnegative(),
      matchedKeyword: z.null(),
    }).strict().optional(),
  }).strict(),
}).strict()

export function envelopeSchema<TPayload extends z.ZodTypeAny>(payloadSchema: TPayload) {
  return z.object({
    contractVersion: z.literal(CONTRACT_VERSION),
    requestId: z.string().min(1),
    generatedAt: isoDateTime,
    sessionId: z.string().min(1).nullable(),
    payload: payloadSchema,
    warnings: z.array(warningSchema),
  }).strict()
}

export const apiSessionEnvelopeSchema = envelopeSchema(apiSessionPayloadSchema)
export const apiFeedEnvelopeSchema = envelopeSchema(apiFeedPayloadSchema)
export const apiReceiptEnvelopeSchema = envelopeSchema(apiReceiptPayloadSchema)

export type ApiSessionPayload = z.infer<typeof apiSessionPayloadSchema>
export type ApiFeedPayload = z.infer<typeof apiFeedPayloadSchema>
export type ApiReceiptPayload = z.infer<typeof apiReceiptPayloadSchema>
export type ApiEnvelope<TPayload> = {
  readonly contractVersion: typeof CONTRACT_VERSION
  readonly requestId: string
  readonly generatedAt: string
  readonly sessionId: string | null
  readonly payload: TPayload
  readonly warnings: readonly z.infer<typeof warningSchema>[]
}

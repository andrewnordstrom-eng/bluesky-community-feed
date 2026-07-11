import { z } from "zod"

export const CONTRACT_VERSION = "2026-07-10.shadow-demo.v3" as const

const signalKeySchema = z.enum(["recency", "engagement", "bridging", "source_diversity", "relevance"])
const topicKeySchema = z.enum(["science-research", "data-science", "software-development", "open-source"])
const communityIdSchema = z.enum([
  "open_science_builders",
  "birders_who_code",
  "crit_fumble_pickup",
  "osint_garden_club",
])
const voterBlocIdSchema = z.enum([
  "research_practitioner",
  "dataset_steward",
  "current_awareness",
  "community_discussant",
  "interdisciplinary_connector",
])

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
  .refine((weights) => topicKeySchema.options.every((key) => weights[key] !== undefined), {
    message: "Topic policy omitted a required Open Science control",
  })

export const apiTopicIntentSchema = z.object({
  topicWeights: apiTopicWeightsSchema,
}).strict()

const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "degraded"]),
}).strict()

const voteSummarySchema = z.object({
  aggregateMethod: z.literal("trimmed_mean_no_trim_under_10"),
  voteCount: z.number().int().nonnegative(),
  trimCount: z.number().int().nonnegative(),
  weights: apiWeightsSchema,
  topicIntent: apiTopicIntentSchema,
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
  createdAt: isoDateTime,
})

const reviewerVoteSchema = voteBaseSchema.extend({
  actorType: z.literal("reviewer"),
  actorId: z.literal("reviewer"),
}).strict()

export const apiSyntheticVoteSchema = voteBaseSchema.extend({
  actorType: z.literal("synthetic_voter"),
  actorId: z.string().regex(/^synthetic-(research_practitioner|dataset_steward|current_awareness|community_discussant|interdisciplinary_connector)-\d+$/),
  blocId: voterBlocIdSchema,
}).strict().superRefine((vote, context) => {
  const actorBloc = vote.actorId.match(/^synthetic-(research_practitioner|dataset_steward|current_awareness|community_discussant|interdisciplinary_connector)-\d+$/)?.[1]
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
  source: z.enum(["production_scores_appview", "fixture_fallback"]),
  candidatePosts72h: z.number().int().nonnegative(),
  publicScoredPosts: z.number().int().nonnegative(),
  uniqueAuthors72h: z.number().int().nonnegative(),
  bridgePostShare: unitNumber,
  topAuthorConcentration: unitNumber,
  sampledAt: isoDateTime,
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

const corpusProvenanceSchema = z.object({
  mode: z.literal("production_sourced_session_frozen"),
  label: z.literal("Live-scored snapshot"),
  description: z.string().min(1),
  corpusId: z.string().min(1),
  productionEpochId: z.number().int().nonnegative(),
  sampledAt: isoDateTime,
  windowHours: z.literal(72),
  topicScoreThreshold: z.literal(0.5),
  eligiblePostCount: z.number().int().nonnegative(),
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
    voterProfiles: z.array(voterProfileSchema),
    votes: z.array(z.union([reviewerVoteSchema, apiSyntheticVoteSchema])),
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
  }).strict()),
}).strict()

export const apiReceiptPayloadSchema = z.object({
  receipt: z.object({
    type: z.literal("shadow_demo_receipt"),
    epochId: z.string().min(1),
    postUri: z.string().startsWith("at://"),
    visibleRank: z.number().int().positive(),
    previousRank: z.number().int().positive().nullable(),
    score: finiteNumber,
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
    provenance: corpusProvenanceSchema.extend({
      shadowEpochId: z.string().min(1),
      postInclusionReasons: z.object({
        matchedTopics: z.array(z.object({ topic: topicKeySchema, score: finiteNumber }).strict()),
        matchedTerms: z.array(z.string().min(1)),
      }).strict(),
    }).strict(),
    counterfactuals: z.array(z.object({
      label: z.enum(["previous_epoch", "engagement_only", "direct_reviewer_ballot_removed"]),
      description: z.string().min(1),
      rank: z.number().int().positive(),
      deltaFromVisible: z.number().int(),
    }).strict()),
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

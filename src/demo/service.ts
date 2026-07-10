import { createHash, randomUUID } from 'node:crypto';
import { DEMO_COMMUNITIES, createDefaultCorpusLoader } from './corpus.js';
import { createSyntheticVoterVotes, getShadowDemoVoterProfiles } from './synthetic-voters.js';
import { createRedisDemoStore, type DemoStore } from './store.js';
import {
  SHADOW_DEMO_CORPUS_PROVENANCE,
  SHADOW_DEMO_GUIDED_EPOCHS,
  SHADOW_DEMO_SESSION_TTL_SECONDS,
  SHADOW_DEMO_MAX_EPOCHS_PER_SESSION,
  SHADOW_DEMO_SHARED_CORPUS_TTL_SECONDS,
  SHADOW_DEMO_SYNTHETIC_VOTER_COUNT,
  SHADOW_DEMO_TOTAL_DEMO_VOTERS,
  type ShadowDemoCommunityId,
  type ShadowDemoCorpus,
  type ShadowDemoCorpusItem,
  type ShadowDemoCounterfactual,
  type ShadowDemoEpoch,
  type ShadowDemoFeedPayload,
  type ShadowDemoRankedPost,
  type ShadowDemoReceiptContribution,
  type ShadowDemoReceiptPayload,
  type ShadowDemoSessionPayload,
  type ShadowDemoSessionState,
  type ShadowDemoTopicIntent,
  type ShadowDemoVote,
  type ShadowDemoWarning,
  type ShadowDemoWeights,
} from './types.js';
import {
  aggregateShadowVotes,
  engagementOnlyWeights,
  scoreFromRawWeights,
  validateShadowWeights,
} from './weights.js';
import { cloneShadowTopicIntent, validateShadowTopicIntent } from './topic-intent.js';

const LOCK_TTL_MS = 5000;
const CORPUS_BUILD_LOCK_TTL_MS = 15000;
const CORPUS_BUILD_LOCK_RENEW_INTERVAL_MS = 5000;
const CORPUS_BUILD_WAIT_INTERVAL_MS = 100;
const CORPUS_BUILD_WAIT_MARGIN_MS = 500;

export class DemoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoValidationError';
  }
}

export class DemoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoConflictError';
  }
}

export class DemoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoNotFoundError';
  }
}

export interface ShadowDemoServiceResult<TPayload> {
  sessionId: string | null;
  payload: TPayload;
  warnings: ShadowDemoWarning[];
}

export interface ShadowDemoServiceDependencies {
  store: DemoStore;
  loadCorpus: (options: {
    communityId: ShadowDemoCommunityId;
    now: Date;
  }) => Promise<ShadowDemoCorpus>;
  now: () => Date;
}

export interface CreateSessionRequest {
  communityId: ShadowDemoCommunityId;
  refreshCorpus: boolean;
}

export interface CastVoteRequest {
  sessionId: string;
  baseEpochId: string;
  weights: unknown;
  topicIntent: unknown;
  idempotencyKey: string | null;
}

export interface RunSyntheticVotersRequest {
  sessionId: string;
  baseEpochId: string;
  idempotencyKey: string | null;
}

export interface AdvanceEpochRequest {
  sessionId: string;
  fromEpochId: string;
  idempotencyKey: string | null;
}

export interface GetFeedRequest {
  sessionId: string;
  epochId: string | null;
  limit: number;
}

export interface GetReceiptRequest {
  sessionId: string;
  epochId: string | null;
  postUri: string;
}

export class ShadowDemoService {
  private readonly store: DemoStore;
  private readonly loadCorpus: ShadowDemoServiceDependencies['loadCorpus'];
  private readonly now: () => Date;

  constructor(dependencies: ShadowDemoServiceDependencies) {
    this.store = dependencies.store;
    this.loadCorpus = dependencies.loadCorpus;
    this.now = dependencies.now;
  }

  async createSession(request: CreateSessionRequest): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> {
    const now = this.now();
    const corpus = await this.loadCorpusForSession({
      communityId: request.communityId,
      now,
      refreshCorpus: request.refreshCorpus,
    });
    const sessionId = `demo-${randomUUID()}`;
    const firstEpoch = createEpoch({
      sequence: 1,
      weights: corpus.baseWeights,
      topicIntent: corpus.baseTopicIntent,
      createdAt: now.toISOString(),
      label: 'Baseline policy',
      decidedByEpochId: null,
    });
    const state: ShadowDemoSessionState = {
      sessionId,
      communityId: request.communityId,
      seed: randomUUID(),
      phase: 'created',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SHADOW_DEMO_SESSION_TTL_SECONDS * 1000).toISOString(),
      corpusId: corpus.corpusId,
      currentEpochId: firstEpoch.id,
      epochs: [firstEpoch],
      votes: [],
      corpus,
      warnings: corpus.warnings,
    };

    await this.store.writeSession(state, ttlSecondsForState(state, now));
    return {
      sessionId,
      payload: sessionPayload(state),
      warnings: state.warnings,
    };
  }

  async getSession(sessionId: string): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> {
    const state = await this.readRequiredSession(sessionId);
    return {
      sessionId,
      payload: sessionPayload(state),
      warnings: state.warnings,
    };
  }

  async castVote(request: CastVoteRequest): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> {
    const operation = async (): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> => {
      const state = await this.readRequiredSession(request.sessionId);
      assertCurrentEpoch(state, request.baseEpochId);
      assertPhaseForReviewerVote(state);
      const weights = validateWeightsForApi(request.weights);
      const topicIntent = validateTopicIntentForApi(request.topicIntent);
      const now = this.now().toISOString();
      const reviewerVote: ShadowDemoVote = {
        id: `vote-reviewer-${request.baseEpochId}`,
        epochId: request.baseEpochId,
        actorType: 'reviewer',
        actorId: 'reviewer',
        label: 'Reviewer',
        weights,
        topicIntent,
        createdAt: now,
      };

      const nextVotes = state.votes
        .filter((vote) => !(vote.epochId === request.baseEpochId && vote.actorType === 'reviewer'))
        .concat(reviewerVote);
      const nextState: ShadowDemoSessionState = {
        ...state,
        phase: 'reviewer_voted',
        votes: nextVotes,
      };
      await this.store.writeSession(nextState, ttlSecondsForState(nextState, this.now()));
      return {
        sessionId: nextState.sessionId,
        payload: sessionPayload(nextState),
        warnings: nextState.warnings,
      };
    };

    return this.runIdempotent({
      sessionId: request.sessionId,
      idempotencyKey: request.idempotencyKey,
      requestPayload: request,
      operation,
    });
  }

  async runSyntheticVoters(
    request: RunSyntheticVotersRequest
  ): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> {
    const operation = async (): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> => {
      const state = await this.readRequiredSession(request.sessionId);
      assertCurrentEpoch(state, request.baseEpochId);
      if (state.phase !== 'reviewer_voted') {
        throw new DemoConflictError('Cast the reviewer vote before running synthetic voters');
      }
      const currentEpoch = currentEpochOf(state);
      const reviewerVote = latestReviewerVoteForEpoch(state, request.baseEpochId);
      if (!reviewerVote) {
        throw new DemoConflictError(`Reviewer vote is missing for ${request.baseEpochId}`);
      }
      const now = this.now().toISOString();
      const syntheticVoterVotes = createSyntheticVoterVotes({
        seed: state.seed,
        epochId: request.baseEpochId,
        communityId: state.communityId,
        reviewerWeights: reviewerVote.weights,
        reviewerTopicIntent: reviewerVote.topicIntent,
        priorCommunityWeights: currentEpoch.aggregate.weights,
        priorTopicIntent: currentEpoch.aggregate.topicIntent,
        createdAt: now,
      });
      const nextVotes = state.votes
        .filter((vote) => !(vote.epochId === request.baseEpochId && vote.actorType === 'synthetic_voter'))
        .concat(syntheticVoterVotes);
      const nextState: ShadowDemoSessionState = {
        ...state,
        phase: 'synthetic_voters_ran',
        votes: nextVotes,
      };
      await this.store.writeSession(nextState, ttlSecondsForState(nextState, this.now()));
      return {
        sessionId: nextState.sessionId,
        payload: sessionPayload(nextState),
        warnings: nextState.warnings,
      };
    };

    return this.runIdempotent({
      sessionId: request.sessionId,
      idempotencyKey: request.idempotencyKey,
      requestPayload: request,
      operation,
    });
  }

  async advanceEpoch(request: AdvanceEpochRequest): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> {
    const operation = async (): Promise<ShadowDemoServiceResult<ShadowDemoSessionPayload>> => {
      const state = await this.readRequiredSession(request.sessionId);
      assertCurrentEpoch(state, request.fromEpochId);
      const currentEpoch = currentEpochOf(state);
      if (currentEpoch.sequence >= SHADOW_DEMO_MAX_EPOCHS_PER_SESSION) {
        throw new DemoConflictError(
          `Shadow demo session reached the ${SHADOW_DEMO_MAX_EPOCHS_PER_SESSION} epoch limit`
        );
      }
      if (state.phase !== 'synthetic_voters_ran') {
        throw new DemoConflictError('Run the synthetic community voters before advancing the epoch');
      }
      const now = this.now().toISOString();
      const decisionVotes = votesForEpoch(state, currentEpoch.id);
      assertCompleteDemoElectorate(decisionVotes, currentEpoch.id);
      const nextAggregate = aggregateShadowVotes(decisionVotes);
      const advancedEpoch: ShadowDemoEpoch = {
        ...currentEpoch,
        status: 'advanced',
        advancedAt: now,
      };
      const nextEpoch = createEpoch({
        sequence: currentEpoch.sequence + 1,
        weights: nextAggregate.weights,
        topicIntent: nextAggregate.topicIntent,
        createdAt: now,
        label: `Shadow epoch ${currentEpoch.sequence + 1}`,
        decidedByEpochId: currentEpoch.id,
      });
      const nextState: ShadowDemoSessionState = {
        ...state,
        phase: 'epoch_advanced',
        currentEpochId: nextEpoch.id,
        epochs: state.epochs.map((epoch) => (epoch.id === currentEpoch.id ? advancedEpoch : epoch)).concat(nextEpoch),
      };
      await this.store.writeSession(nextState, ttlSecondsForState(nextState, this.now()));
      return {
        sessionId: nextState.sessionId,
        payload: sessionPayload(nextState),
        warnings: nextState.warnings,
      };
    };

    return this.runIdempotent({
      sessionId: request.sessionId,
      idempotencyKey: request.idempotencyKey,
      requestPayload: request,
      operation,
    });
  }

  async getFeed(request: GetFeedRequest): Promise<ShadowDemoServiceResult<ShadowDemoFeedPayload>> {
    const state = await this.readRequiredSession(request.sessionId);
    const epoch = epochByIdOrCurrent(state, request.epochId);
    const previousEpoch = previousEpochFor(state, epoch);
    const posts = rankedPosts({
      corpus: state.corpus,
      epoch,
      previousEpoch,
      limit: request.limit,
    });
    return {
      sessionId: state.sessionId,
      payload: {
        epochId: epoch.id,
        corpusId: state.corpusId,
        communityId: state.communityId,
        corpusHealth: state.corpus.health,
        aggregate: epoch.aggregate,
        posts,
      },
      warnings: state.warnings,
    };
  }

  async getReceipt(request: GetReceiptRequest): Promise<ShadowDemoServiceResult<ShadowDemoReceiptPayload>> {
    const state = await this.readRequiredSession(request.sessionId);
    const epoch = epochByIdOrCurrent(state, request.epochId);
    const item = state.corpus.items.find((candidate) => candidate.postUri === request.postUri);
    if (!item) {
      throw new DemoValidationError(`Post URI is not part of this frozen demo corpus: ${request.postUri}`);
    }
    if (item.displayPost.kind !== 'public_post') {
      throw new DemoValidationError('Receipt is unavailable for a post hidden by Bluesky public-view policy');
    }

    const previousEpoch = previousEpochFor(state, epoch);
    const fullRankedPosts = rankedPosts({
      corpus: state.corpus,
      epoch,
      previousEpoch,
      limit: state.corpus.items.length,
    });
    const rankedPost = fullRankedPosts.find(
      (candidate) => candidate.post.kind === 'public_post' && candidate.post.uri === request.postUri
    );
    if (!rankedPost) {
      throw new DemoValidationError(`Ranked post missing from frozen corpus: ${request.postUri}`);
    }
    if (rankedPost.score === null) {
      throw new DemoValidationError(`Receipt score unavailable for hidden post: ${request.postUri}`);
    }

    return {
      sessionId: state.sessionId,
      payload: {
        receipt: {
          type: 'shadow_demo_receipt',
          epochId: epoch.id,
          postUri: request.postUri,
          visibleRank: rankedPost.rank,
          previousRank: rankedPost.previousRank,
          score: rankedPost.score,
          scoredAt: item.scoredAt,
          aggregate: epoch.aggregate,
          components: receiptContributions(
            item,
            epoch.aggregate.weights,
            epoch.aggregate.topicIntent
          ),
          topicSignals: topicSignals(item, epoch.aggregate.topicIntent),
          counterfactuals: counterfactualsForReceipt({
            state,
            item,
            epoch,
            visibleRank: rankedPost.rank,
          }),
        },
      },
      warnings: state.warnings,
    };
  }

  private async readRequiredSession(sessionId: string): Promise<ShadowDemoSessionState> {
    const state = await this.store.readSession(sessionId);
    if (!state) {
      throw new DemoNotFoundError(`Shadow demo session not found or expired: ${sessionId}`);
    }
    return state;
  }

  private async loadCorpusForSession(options: {
    communityId: ShadowDemoCommunityId;
    now: Date;
    refreshCorpus: boolean;
  }): Promise<ShadowDemoCorpus> {
    const cached = options.refreshCorpus ? null : await this.store.readSharedCorpus(options.communityId);
    if (cached) {
      return cloneCorpusForSession({
        corpus: cached,
        communityId: options.communityId,
        now: options.now,
      });
    }

    const token = randomUUID();
    const acquired = await this.store.acquireCorpusBuildLock(
      options.communityId,
      token,
      CORPUS_BUILD_LOCK_TTL_MS
    );
    if (!acquired) {
      if (options.refreshCorpus) {
        throw new DemoConflictError(
          `Shadow demo corpus refresh is already running for ${options.communityId}; retry shortly`
        );
      }
      const waited = await this.waitForSharedCorpus(options.communityId);
      if (waited) {
        return cloneCorpusForSession({
          corpus: waited,
          communityId: options.communityId,
          now: options.now,
        });
      }
      throw new DemoConflictError(
        `Shadow demo corpus is warming for ${options.communityId}; retry session creation shortly`
      );
    }

    const leaseState: { failure: Error | null } = { failure: null };
    let renewalInFlight: Promise<void> = Promise.resolve();
    const renewalTimer = setInterval(() => {
      renewalInFlight = renewalInFlight
        .then(async () => {
          if (leaseState.failure !== null) {
            return;
          }
          const renewed = await this.store.renewCorpusBuildLock(
            options.communityId,
            token,
            CORPUS_BUILD_LOCK_TTL_MS
          );
          if (!renewed) {
            throw new Error(`Corpus build lease was lost for ${options.communityId}`);
          }
        })
        .catch((err: unknown) => {
          leaseState.failure = err instanceof Error ? err : new Error(String(err));
        });
    }, CORPUS_BUILD_LOCK_RENEW_INTERVAL_MS);

    try {
      const corpus = await this.loadCorpus(options);
      await renewalInFlight;
      if (leaseState.failure !== null) {
        throw new DemoConflictError(leaseState.failure.message);
      }
      const stillOwned = await this.store.renewCorpusBuildLock(
        options.communityId,
        token,
        CORPUS_BUILD_LOCK_TTL_MS
      );
      if (!stillOwned) {
        throw new DemoConflictError(`Corpus build lease was lost for ${options.communityId}`);
      }
      await this.store.writeSharedCorpus(
        options.communityId,
        corpus,
        SHADOW_DEMO_SHARED_CORPUS_TTL_SECONDS
      );
      return cloneCorpusForSession({
        corpus,
        communityId: options.communityId,
        now: options.now,
      });
    } finally {
      clearInterval(renewalTimer);
      await renewalInFlight;
      if (acquired) {
        await this.store.releaseCorpusBuildLock(options.communityId, token);
      }
    }
  }

  private async waitForSharedCorpus(
    communityId: ShadowDemoCommunityId
  ): Promise<ShadowDemoCorpus | null> {
    const maxAttempts = Math.ceil(
      (CORPUS_BUILD_LOCK_TTL_MS + CORPUS_BUILD_WAIT_MARGIN_MS) / CORPUS_BUILD_WAIT_INTERVAL_MS
    );
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(CORPUS_BUILD_WAIT_INTERVAL_MS);
      const cached = await this.store.readSharedCorpus(communityId);
      if (cached) {
        return cached;
      }
    }
    return null;
  }

  private async withSessionLock<TPayload>(
    sessionId: string,
    operation: () => Promise<TPayload>
  ): Promise<TPayload> {
    const token = randomUUID();
    const acquired = await this.store.acquireSessionLock(sessionId, token, LOCK_TTL_MS);
    if (!acquired) {
      throw new DemoConflictError(`Shadow demo session is busy: ${sessionId}`);
    }
    try {
      return await operation();
    } finally {
      await this.store.releaseSessionLock(sessionId, token);
    }
  }

  private async runIdempotent<TPayload>(options: {
    sessionId: string;
    idempotencyKey: string | null;
    requestPayload: unknown;
    operation: () => Promise<TPayload>;
  }): Promise<TPayload> {
    return this.withSessionLock(options.sessionId, async () => {
      if (!options.idempotencyKey) {
        return options.operation();
      }

      const requestHash = hashPayload(options.requestPayload);
      const existing = await this.store.readIdempotency<TPayload>(
        options.sessionId,
        options.idempotencyKey
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new DemoConflictError(`Idempotency key reused with a different payload: ${options.idempotencyKey}`);
        }
        return existing.response;
      }

      const response = await options.operation();
      await this.store.writeIdempotency(
        options.sessionId,
        options.idempotencyKey,
        {
          requestHash,
          response,
          createdAt: this.now().toISOString(),
        },
        await idempotencyTtlSecondsForSession(this.store, options.sessionId, this.now())
      );
      return response;
    });
  }
}

export function createDefaultShadowDemoService(): ShadowDemoService {
  return new ShadowDemoService({
    store: createRedisDemoStore(),
    loadCorpus: createDefaultCorpusLoader(),
    now: () => new Date(),
  });
}

function sessionPayload(state: ShadowDemoSessionState): ShadowDemoSessionPayload {
  return {
    session: {
      sessionId: state.sessionId,
      community: DEMO_COMMUNITIES[state.communityId],
      phase: state.phase,
      currentEpochId: state.currentEpochId,
      expiresAt: state.expiresAt,
      corpusHealth: state.corpus.health,
      epochs: state.epochs,
      pendingAggregate: pendingAggregateFor(state),
      voteCount: state.votes.length,
      guidedEpochs: SHADOW_DEMO_GUIDED_EPOCHS,
      maxEpochs: SHADOW_DEMO_MAX_EPOCHS_PER_SESSION,
      syntheticVoterCount: SHADOW_DEMO_SYNTHETIC_VOTER_COUNT,
      totalDemoVoters: SHADOW_DEMO_TOTAL_DEMO_VOTERS,
      corpusProvenance: SHADOW_DEMO_CORPUS_PROVENANCE,
      voterProfiles: getShadowDemoVoterProfiles(),
      votes: state.votes,
    },
  };
}

function cloneCorpusForSession(options: {
  corpus: ShadowDemoCorpus;
  communityId: ShadowDemoCommunityId;
  now: Date;
}): ShadowDemoCorpus {
  return {
    ...(JSON.parse(JSON.stringify(options.corpus)) as ShadowDemoCorpus),
    corpusId: `corpus-${randomUUID()}`,
    communityId: options.communityId,
    createdAt: options.now.toISOString(),
    expiresAt: new Date(options.now.getTime() + SHADOW_DEMO_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

function ttlSecondsForState(state: ShadowDemoSessionState, now: Date): number {
  const expiresAt = new Date(state.expiresAt).getTime();
  const ttlMs = expiresAt - now.getTime();
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

async function idempotencyTtlSecondsForSession(
  store: DemoStore,
  sessionId: string,
  now: Date
): Promise<number> {
  const state = await store.readSession(sessionId);
  return state ? ttlSecondsForState(state, now) : SHADOW_DEMO_SESSION_TTL_SECONDS;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createEpoch(options: {
  sequence: number;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
  createdAt: string;
  label: string;
  decidedByEpochId: string | null;
}): ShadowDemoEpoch {
  return {
    id: `shadow-epoch-${options.sequence}`,
    sequence: options.sequence,
    label: options.label,
    status: 'open',
    createdAt: options.createdAt,
    advancedAt: null,
    decidedByEpochId: options.decidedByEpochId,
    aggregate: {
      aggregateMethod: 'trimmed_mean_no_trim_under_10',
      voteCount: 0,
      trimCount: 0,
      weights: options.weights,
      topicIntent: cloneShadowTopicIntent(options.topicIntent),
    },
  };
}

function validateWeightsForApi(value: unknown): ShadowDemoWeights {
  try {
    return validateShadowWeights(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DemoValidationError(message);
  }
}

function validateTopicIntentForApi(value: unknown): ShadowDemoTopicIntent {
  try {
    return validateShadowTopicIntent(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DemoValidationError(message);
  }
}

function assertCurrentEpoch(state: ShadowDemoSessionState, epochId: string): void {
  if (state.currentEpochId !== epochId) {
    throw new DemoConflictError(
      `Stale shadow demo epoch. Current epoch is ${state.currentEpochId}; received ${epochId}`
    );
  }
}

function currentEpochOf(state: ShadowDemoSessionState): ShadowDemoEpoch {
  const epoch = state.epochs.find((candidate) => candidate.id === state.currentEpochId);
  if (!epoch) {
    throw new DemoConflictError(`Current shadow demo epoch is missing: ${state.currentEpochId}`);
  }
  return epoch;
}

function epochByIdOrCurrent(state: ShadowDemoSessionState, epochId: string | null): ShadowDemoEpoch {
  if (!epochId) {
    return currentEpochOf(state);
  }
  const epoch = state.epochs.find((candidate) => candidate.id === epochId);
  if (!epoch) {
    throw new DemoValidationError(`Unknown shadow demo epoch for this session: ${epochId}`);
  }
  return epoch;
}

function previousEpochFor(state: ShadowDemoSessionState, epoch: ShadowDemoEpoch): ShadowDemoEpoch | null {
  const previousSequence = epoch.sequence - 1;
  return state.epochs.find((candidate) => candidate.sequence === previousSequence) ?? null;
}

function latestReviewerVoteForEpoch(
  state: ShadowDemoSessionState,
  epochId: string
): ShadowDemoVote | null {
  const vote = [...state.votes]
    .reverse()
    .find((candidate) => candidate.epochId === epochId && candidate.actorType === 'reviewer');
  return vote ?? null;
}

function votesForEpoch(state: ShadowDemoSessionState, epochId: string): ShadowDemoVote[] {
  return state.votes.filter((vote) => vote.epochId === epochId);
}

function pendingAggregateFor(state: ShadowDemoSessionState): ReturnType<typeof aggregateShadowVotes> | null {
  const votes = votesForEpoch(state, state.currentEpochId);
  return votes.length > 0 ? aggregateShadowVotes(votes) : null;
}

function assertPhaseForReviewerVote(state: ShadowDemoSessionState): void {
  if (!['created', 'epoch_advanced', 'reviewer_voted'].includes(state.phase)) {
    throw new DemoConflictError(`Cannot cast a reviewer vote during phase ${state.phase}`);
  }
}

function assertCompleteDemoElectorate(votes: ShadowDemoVote[], epochId: string): void {
  const reviewerVotes = votes.filter((vote) => vote.actorType === 'reviewer').length;
  const syntheticVotes = votes.filter((vote) => vote.actorType === 'synthetic_voter').length;
  if (reviewerVotes !== 1 || syntheticVotes !== SHADOW_DEMO_SYNTHETIC_VOTER_COUNT) {
    throw new DemoConflictError(
      `Shadow epoch ${epochId} requires 1 reviewer and ${SHADOW_DEMO_SYNTHETIC_VOTER_COUNT} synthetic votes; received ${reviewerVotes} reviewer and ${syntheticVotes} synthetic votes`
    );
  }
}

function rankedPosts(options: {
  corpus: ShadowDemoCorpus;
  epoch: ShadowDemoEpoch;
  previousEpoch: ShadowDemoEpoch | null;
  limit: number;
}): ShadowDemoRankedPost[] {
  const previousRanks = options.previousEpoch
    ? rankMapForEpoch(options.corpus.items, options.previousEpoch)
    : new Map<string, number>();
  return options.corpus.items
    .map((item) => {
      const scored = scoreFromRawWeights(
        item.rawScores,
        options.epoch.aggregate.weights,
        item.topicVector,
        options.epoch.aggregate.topicIntent
      );
      return {
        item,
        score: scored.score,
        weightedComponents: scored.weightedComponents,
        effectiveRawScores: scored.effectiveRawScores,
      };
    })
    .sort((left, right) => right.score - left.score || left.item.postUri.localeCompare(right.item.postUri))
    .slice(0, options.limit)
    .map((entry, index) => {
      const rank = index + 1;
      const previousRank = previousRanks.get(entry.item.postUri) ?? null;
      return {
        rank,
        previousRank,
        movement: previousRank === null ? null : previousRank - rank,
        score: entry.item.displayPost.kind === 'public_post' ? entry.score : null,
        weightedComponents:
          entry.item.displayPost.kind === 'public_post' ? entry.weightedComponents : null,
        rawScores: entry.item.displayPost.kind === 'public_post' ? entry.effectiveRawScores : null,
        post: entry.item.displayPost,
      };
    });
}

function rankMapForEpoch(items: ShadowDemoCorpusItem[], epoch: ShadowDemoEpoch): Map<string, number> {
  const ranks = new Map<string, number>();
  items
    .map((item) => ({
      item,
      score: scoreFromRawWeights(
        item.rawScores,
        epoch.aggregate.weights,
        item.topicVector,
        epoch.aggregate.topicIntent
      ).score,
    }))
    .sort((left, right) => right.score - left.score || left.item.postUri.localeCompare(right.item.postUri))
    .forEach((entry, index) => ranks.set(entry.item.postUri, index + 1));
  return ranks;
}

function receiptContributions(
  item: ShadowDemoCorpusItem,
  weights: ShadowDemoWeights,
  topicIntent: ShadowDemoTopicIntent
): ShadowDemoReceiptContribution[] {
  const scored = scoreFromRawWeights(item.rawScores, weights, item.topicVector, topicIntent);
  return Object.entries(scored.weightedComponents).map(([signal, contribution]) => ({
    signal: signal as ShadowDemoReceiptContribution['signal'],
    rawScore: scored.effectiveRawScores[signal as keyof typeof scored.effectiveRawScores],
    weight: weights[signal as keyof ShadowDemoWeights],
    contribution,
  }));
}

function topicSignals(
  item: ShadowDemoCorpusItem,
  topicIntent: ShadowDemoTopicIntent
): Array<{ topic: string; postScore: number }> {
  return Object.entries(item.topicVector)
    .filter(([topic, value]) =>
      Object.hasOwn(topicIntent.topicWeights, topic) &&
      typeof value === 'number' &&
      Number.isFinite(value)
    )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([topic, postScore]) => ({ topic, postScore }));
}

function counterfactualsForReceipt(options: {
  state: ShadowDemoSessionState;
  item: ShadowDemoCorpusItem;
  epoch: ShadowDemoEpoch;
  visibleRank: number;
}): ShadowDemoCounterfactual[] {
  const previousEpoch = previousEpochFor(options.state, options.epoch);
  const previousWeights = previousEpoch?.aggregate.weights ?? options.state.corpus.baseWeights;
  const previousTopicIntent = previousEpoch?.aggregate.topicIntent ?? options.state.corpus.baseTopicIntent;
  const withoutReviewer = aggregateWithoutReviewerVote(options.state, options.epoch);
  return [
    counterfactualForWeights({
      label: 'previous_epoch',
      state: options.state,
      item: options.item,
      weights: previousWeights,
      topicIntent: previousTopicIntent,
      visibleRank: options.visibleRank,
    }),
    counterfactualForWeights({
      label: 'engagement_only',
      state: options.state,
      item: options.item,
      weights: engagementOnlyWeights(),
      topicIntent: options.epoch.aggregate.topicIntent,
      visibleRank: options.visibleRank,
    }),
    counterfactualForWeights({
      label: 'without_reviewer_vote',
      state: options.state,
      item: options.item,
      weights: withoutReviewer.weights,
      topicIntent: withoutReviewer.topicIntent,
      visibleRank: options.visibleRank,
    }),
  ];
}

function aggregateWithoutReviewerVote(
  state: ShadowDemoSessionState,
  epoch: ShadowDemoEpoch
): ShadowDemoEpoch['aggregate'] {
  const decisionEpochId = epoch.decidedByEpochId;
  if (!decisionEpochId) {
    return previousEpochFor(state, epoch)?.aggregate ?? epoch.aggregate;
  }
  const nonReviewerVotes = state.votes
    .filter((vote) => vote.epochId === decisionEpochId && vote.actorType !== 'reviewer');
  if (nonReviewerVotes.length === 0) {
    return previousEpochFor(state, epoch)?.aggregate ?? epoch.aggregate;
  }
  return aggregateShadowVotes(nonReviewerVotes);
}

function counterfactualForWeights(options: {
  label: ShadowDemoCounterfactual['label'];
  state: ShadowDemoSessionState;
  item: ShadowDemoCorpusItem;
  weights: ShadowDemoWeights;
  topicIntent: ShadowDemoTopicIntent;
  visibleRank: number;
}): ShadowDemoCounterfactual {
  const rank = rankForWeights(
    options.state.corpus.items,
    options.item.postUri,
    options.weights,
    options.topicIntent
  );
  return {
    label: options.label,
    rank,
    deltaFromVisible: rank - options.visibleRank,
  };
}

function rankForWeights(
  items: ShadowDemoCorpusItem[],
  postUri: string,
  weights: ShadowDemoWeights,
  topicIntent: ShadowDemoTopicIntent
): number {
  const ranked = items
    .map((item) => ({
      postUri: item.postUri,
      score: scoreFromRawWeights(item.rawScores, weights, item.topicVector, topicIntent).score,
    }))
    .sort((left, right) => right.score - left.score || left.postUri.localeCompare(right.postUri));
  const index = ranked.findIndex((entry) => entry.postUri === postUri);
  if (index < 0) {
    throw new DemoValidationError(`Post URI is not rankable in this corpus: ${postUri}`);
  }
  return index + 1;
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

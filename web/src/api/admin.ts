/**
 * Admin API Client
 *
 * API functions for admin dashboard endpoints.
 * All requests include credentials and proper auth headers.
 */

import { api } from './client';
import type { GovernanceWeights, ContentRules } from '@shared/api-types';

export type { GovernanceWeights, ContentRules };

export interface RoundSummary {
  id: number;
  status: string;
  phase?: 'running' | 'voting' | 'results';
  voteCount: number;
  createdAt: string;
  closedAt: string | null;
  votingEndsAt: string | null;
  votingStartedAt?: string | null;
  votingClosedAt?: string | null;
  resultsApprovedAt?: string | null;
  resultsApprovedBy?: string | null;
  proposedWeights?: GovernanceWeights | null;
  proposedContentRules?: ContentRules | null;
  autoTransition: boolean;
  weights: GovernanceWeights;
  contentRules: ContentRules;
}

export interface GovernanceStatus {
  currentRound: RoundSummary | null;
  rounds: RoundSummary[];
  weights: GovernanceWeights | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  votingEndsAt: string | null;
  autoTransition: boolean;
}

export interface ScheduledVote {
  id: number;
  startsAt: string;
  durationHours: number;
  announced: boolean;
  createdBy: string;
  createdAt: string;
}

export interface RoundDetails {
  round: RoundSummary;
  startingWeights: GovernanceWeights;
  endingWeights: GovernanceWeights;
  startingRules: ContentRules;
  endingRules: ContentRules;
  voteCount: number;
  weightConfigurations: Array<{
    count: number;
    weights: GovernanceWeights | null;
  }>;
  duration: {
    startedAt: string;
    endedAt: string | null;
    durationMs: number;
  };
  auditTrail: Array<{
    action: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export interface Participant {
  did: string;
  handle: string | null;
  added_by: string;
  notes: string | null;
  added_at: string;
}

export interface AdminStatus {
  isAdmin: boolean;
  feedPrivateMode: boolean;
  system: {
    currentEpoch: {
      id: number;
      status: string;
      votingOpen: boolean;
      votingEndsAt: string | null;
      autoTransition: boolean;
      voteCount: number;
      weights: GovernanceWeights;
      contentRules: { include_keywords: string[]; exclude_keywords: string[] };
      createdAt: string;
    } | null;
    feed: {
      totalPosts: number;
      postsLast24h: number;
      scoredPosts: number;
      lastScoringRun: string | null;
      lastScoringDuration: number | null;
      subscriberCount: number;
    };
    contentRules: {
      includeKeywords: string[];
      excludeKeywords: string[];
    };
  };
}

export interface Epoch {
  id: number;
  status: string;
  votingOpen: boolean;
  votingEndsAt: string | null;
  autoTransition: boolean;
  weights: Record<string, number>;
  contentRules: { include_keywords: string[]; exclude_keywords: string[] };
  voteCount: number;
  createdAt: string;
  endedAt: string | null;
}

export interface Announcement {
  id: number;
  epochId: number | null;
  content: string;
  postUri: string;
  postUrl: string;
  type: string;
  postedAt: string;
  postedBy: string;
}

export interface FeedHealth {
  database: {
    totalPosts: number;
    postsLast24h: number;
    postsLast7d: number;
    oldestPost: string;
    newestPost: string;
  };
  scoring: {
    lastRun: string | null;
    lastRunDuration: number | null;
    postsScored: number;
    postsFiltered: number;
  };
  jetstream: {
    connected: boolean;
    lastEvent: string | null;
    eventsLast5min: number;
    disconnectedForSeconds?: number | null;
  };
  subscribers: {
    total: number;
    withVotes: number;
    activeLastWeek: number;
  };
  contentRules: {
    includeKeywords: string[];
    excludeKeywords: string[];
    lastUpdated: string | null;
  };
  feedSize?: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: string;
  epochId?: number;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface SchedulerStatus {
  scheduler: {
    running: boolean;
    schedule: string;
  };
  pendingTransitions: Array<{
    epochId: number;
    votingEndsAt: string;
    autoTransition: boolean;
    readyForTransition: boolean;
  }>;
}

export interface WeightImpactPost {
  uri: string;
  textPreview: string | null;
  rank: number;
  totalScore: number;
  components: {
    recency: { raw: number; weighted: number };
    engagement: { raw: number; weighted: number };
    bridging: { raw: number; weighted: number };
    sourceDiversity: { raw: number; weighted: number };
    relevance: { raw: number; weighted: number };
  };
  dominantFactor: keyof GovernanceWeights;
  wouldRankWithEqualWeights: number;
}

export interface WeightSensitivityMetric {
  postsAffected: number;
  avgRankChange: number;
}

export interface WeightImpactResponse {
  currentEpochId: number;
  currentWeights: GovernanceWeights;
  topPosts: WeightImpactPost[];
  weightSensitivity: Record<keyof GovernanceWeights, WeightSensitivityMetric>;
  analyzedPosts: number;
  generatedAt: string;
}

// Topic types
export interface AdminTopic {
  slug: string;
  name: string;
  description: string | null;
  parentSlug: string | null;
  terms: string[];
  contextTerms: string[];
  antiTerms: string[];
  isActive: boolean;
  postCount: number;
  currentWeight: number | null;
  createdAt: string;
}

export interface ClassifyResult {
  vector: Record<string, number>;
  matchedTopics: string[];
  tokenCount: number;
}

// Interaction types
export interface InteractionOverview {
  today: {
    totalRequests: number;
    uniqueViewers: number;
    anonymousRequests: number;
    avgScrollDepth: number;
    avgResponseTimeMs: number;
    returningViewers: number;
  };
  yesterday: {
    totalRequests: number;
    uniqueViewers: number;
    anonymousRequests: number;
    avgScrollDepth: number;
    returningViewers: number;
  } | null;
  trend: Array<{
    date: string;
    totalRequests: number;
    uniqueViewers: number;
    anonymousRequests: number;
    maxScrollDepth: number;
    avgPagesPerSession: number;
    returningViewers: number;
  }>;
}

export interface ScrollDepthData {
  histogram: Array<{
    bucket: string;
    sessionCount: number;
  }>;
}

export interface EngagementData {
  overall: {
    totalServed: number;
    totalEngaged: number;
    engagementRate: number;
    likes: number;
    reposts: number;
  };
  byPosition: Array<{
    bucket: string;
    served: number;
    engaged: number;
    rate: number;
  }>;
}

export interface EpochComparisonData {
  epochs: Array<{
    epochId: number;
    totalFeedLoads: number;
    uniqueViewers: number;
    avgScrollDepth: number | null;
    returningViewerPct: number | null;
    engagementRate: number | null;
    avgEngagementPosition: number | null;
    postsServed: number;
    postsWithEngagement: number;
    computedAt: string;
    epochStartedAt: string;
  }>;
}

export interface KeywordPerformanceData {
  keywords: Array<{
    keyword: string;
    served: number;
    engaged: number;
    rate: number;
  }>;
  currentRules: {
    includeKeywords: string[];
    excludeKeywords: string[];
  };
}

// API Functions
export const adminApi = {
  async getStatus(): Promise<AdminStatus> {
    const response = await api.get('/api/admin/status');
    return response.data;
  },

  async getEpochs(): Promise<{ epochs: Epoch[] }> {
    const response = await api.get('/api/admin/epochs');
    return response.data;
  },

  async updateEpoch(data: {
    votingOpen?: boolean;
    votingEndsAt?: string | null;
    autoTransition?: boolean;
  }): Promise<{ success: boolean; epoch: Partial<Epoch> }> {
    const response = await api.patch('/api/admin/epochs/current', data);
    return response.data;
  },

  async transitionEpoch(options: { force?: boolean; announceResults?: boolean } = {}): Promise<{
    success: boolean;
    previousEpoch: { id: number; totalVotes: number };
    newEpoch: { id: number };
    announcement: { postUrl: string } | null;
  }> {
    const response = await api.post('/api/admin/epochs/transition', options);
    return response.data;
  },

  async closeVoting(): Promise<{ success: boolean }> {
    const response = await api.post('/api/admin/epochs/close-voting');
    return response.data;
  },

  async openVoting(): Promise<{ success: boolean }> {
    const response = await api.post('/api/admin/epochs/open-voting');
    return response.data;
  },

  async getAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const response = await api.get('/api/admin/announcements');
    return response.data;
  },

  async postAnnouncement(data: { content: string; includeEpochLink?: boolean }): Promise<{
    success: boolean;
    announcement: { postUri: string; postUrl: string };
  }> {
    const response = await api.post('/api/admin/announcements', data);
    return response.data;
  },

  async getFeedHealth(): Promise<FeedHealth> {
    const response = await api.get('/api/admin/feed-health');
    return response.data;
  },

  async triggerRescore(): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/api/admin/feed/rescore');
    return response.data;
  },

  async triggerJetstreamReconnect(): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/api/admin/jetstream/reconnect');
    return response.data;
  },

  async getAuditLog(params: { action?: string; actor?: string; limit?: number } = {}): Promise<{
    entries: AuditEntry[];
    total: number;
  }> {
    const response = await api.get('/api/admin/audit-log', { params });
    return response.data;
  },

  async getWeightImpact(limit = 20): Promise<WeightImpactResponse> {
    const response = await api.get('/api/admin/audit/weight-impact', {
      params: { limit },
    });
    return response.data;
  },

  async getSchedulerStatus(): Promise<SchedulerStatus> {
    const response = await api.get('/api/admin/scheduler/status');
    return response.data;
  },

  async triggerSchedulerCheck(): Promise<{
    success: boolean;
    transitioned: number;
    errors: number;
  }> {
    const response = await api.post('/api/admin/scheduler/check');
    return response.data;
  },

  async getGovernanceStatus(): Promise<GovernanceStatus> {
    const response = await api.get('/api/admin/governance');
    return response.data;
  },

  async updateContentRules(contentRules: {
    includeKeywords?: string[];
    excludeKeywords?: string[];
  }): Promise<{ success: boolean; rules: ContentRules; rescoreTriggered: boolean }> {
    const response = await api.patch('/api/admin/governance/content-rules', contentRules);
    return response.data;
  },

  async addKeyword(type: 'include' | 'exclude', keyword: string): Promise<{
    success: boolean;
    rules: ContentRules;
    rescoreTriggered: boolean;
  }> {
    const response = await api.post('/api/admin/governance/content-rules/keyword', { type, keyword });
    return response.data;
  },

  async removeKeyword(
    type: 'include' | 'exclude',
    keyword: string,
    confirm?: boolean
  ): Promise<{ success: boolean; rules: ContentRules; rescoreTriggered: boolean }> {
    const response = await api.delete('/api/admin/governance/content-rules/keyword', {
      data: { type, keyword, confirm },
    });
    return response.data;
  },

  async updateWeights(weights: Partial<GovernanceWeights>): Promise<{
    success: boolean;
    weights: GovernanceWeights;
    rescoreTriggered: boolean;
  }> {
    const response = await api.patch('/api/admin/governance/weights', weights);
    return response.data;
  },

  async extendVoting(hours: number): Promise<{ success: boolean; round: RoundSummary }> {
    const response = await api.post('/api/admin/governance/extend-voting', { hours });
    return response.data;
  },

  async applyResults(): Promise<{
    success: boolean;
    voteCount: number;
    appliedWeights: boolean;
    weights: GovernanceWeights;
    contentRules: ContentRules;
    round: RoundSummary;
    rescoreTriggered: boolean;
  }> {
    const response = await api.post('/api/admin/governance/apply-results');
    return response.data;
  },

  async getRoundDetails(id: number): Promise<RoundDetails> {
    const response = await api.get(`/api/admin/governance/rounds/${id}`);
    return response.data;
  },

  async endRound(force = false): Promise<{ success: boolean; newRoundId: number }> {
    const response = await api.post('/api/admin/governance/end-round', { force });
    return response.data;
  },

  async startVoting(durationHours: number, announce = true): Promise<{ success: boolean; round: RoundSummary }> {
    const response = await api.post('/api/admin/governance/start-voting', {
      durationHours,
      announce,
    });
    return response.data;
  },

  async endVoting(announce = true): Promise<{
    success: boolean;
    voteCount: number;
    proposedWeights: GovernanceWeights;
    proposedContentRules: ContentRules;
    round: RoundSummary;
  }> {
    const response = await api.post('/api/admin/governance/end-voting', {
      announce,
    });
    return response.data;
  },

  async approveResults(announce = true): Promise<{
    success: boolean;
    weights: GovernanceWeights;
    contentRules: ContentRules;
    rescoreTriggered: boolean;
    round: RoundSummary;
  }> {
    const response = await api.post('/api/admin/governance/approve-results', {
      announce,
    });
    return response.data;
  },

  async rejectResults(): Promise<{ success: boolean; round: RoundSummary }> {
    const response = await api.post('/api/admin/governance/reject-results');
    return response.data;
  },

  async scheduleVote(startsAt: string, durationHours: number): Promise<{
    success: boolean;
    scheduledVote: ScheduledVote;
  }> {
    const response = await api.post('/api/admin/governance/schedule-vote', {
      startsAt,
      durationHours,
    });
    return response.data;
  },

  async getVoteSchedule(): Promise<{ scheduledVotes: ScheduledVote[] }> {
    const response = await api.get('/api/admin/governance/schedule');
    return response.data;
  },

  // Interaction tracking endpoints
  async getInteractionOverview(): Promise<InteractionOverview> {
    const response = await api.get('/api/admin/interactions/overview');
    return response.data;
  },

  async getScrollDepth(): Promise<ScrollDepthData> {
    const response = await api.get('/api/admin/interactions/scroll-depth');
    return response.data;
  },

  async getEngagement(): Promise<EngagementData> {
    const response = await api.get('/api/admin/interactions/engagement');
    return response.data;
  },

  async getEpochComparison(): Promise<EpochComparisonData> {
    const response = await api.get('/api/admin/interactions/epoch-comparison');
    return response.data;
  },

  async getKeywordPerformance(): Promise<KeywordPerformanceData> {
    const response = await api.get('/api/admin/interactions/keyword-performance');
    return response.data;
  },

  // Participant management
  async getParticipants(): Promise<{ participants: Participant[]; total: number }> {
    const response = await api.get('/api/admin/participants');
    return response.data;
  },

  async addParticipant(data: {
    did?: string;
    handle?: string;
    notes?: string;
  }): Promise<{ success: boolean; participant: { did: string; handle: string | null; notes: string | null } }> {
    const response = await api.post('/api/admin/participants', data);
    return response.data;
  },

  async removeParticipant(did: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/api/admin/participants/${encodeURIComponent(did)}`);
    return response.data;
  },

  // Topic management
  async getTopics(): Promise<AdminTopic[]> {
    const response = await api.get('/api/admin/topics');
    return response.data;
  },

  async addTopic(data: {
    slug: string;
    name: string;
    description?: string;
    parentSlug?: string;
    terms: string[];
    contextTerms?: string[];
    antiTerms?: string[];
  }): Promise<{ success: boolean }> {
    const response = await api.post('/api/admin/topics', data);
    return response.data;
  },

  async updateTopic(slug: string, data: {
    name?: string;
    terms?: string[];
    contextTerms?: string[];
    antiTerms?: string[];
  }): Promise<{ success: boolean }> {
    const response = await api.patch(`/api/admin/topics/${encodeURIComponent(slug)}`, data);
    return response.data;
  },

  async deactivateTopic(slug: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/api/admin/topics/${encodeURIComponent(slug)}`);
    return response.data;
  },

  async classifyText(text: string): Promise<ClassifyResult> {
    const response = await api.post('/api/admin/topics/classify', { text });
    return response.data;
  },
};

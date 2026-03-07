import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScoreRadar } from '../components/ScoreRadar';
import { TopicWeightChart } from '../components/TopicWeightChart';
import { DashboardSkeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/useAuth';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { transparencyApi, voteApi } from '../api/client';
import type { FeedStatsResponse, AuditLogEntry, EpochResponse, TopicCatalogResponse } from '../api/client';

interface WeightChange {
  key: keyof EpochResponse['weights'];
  previous: number;
  current: number;
  delta: number;
}

interface KeywordChanges {
  includeAdded: string[];
  includeRemoved: string[];
  excludeAdded: string[];
  excludeRemoved: string[];
}

interface LatestRoundUpdate {
  currentRoundId: number;
  previousRoundId: number;
  participantCount: number;
  appliedAt: string;
  weightChanges: WeightChange[];
  keywordChanges: KeywordChanges;
}

const WEIGHT_LABELS: Record<keyof EpochResponse['weights'], string> = {
  recency: 'Recency',
  engagement: 'Engagement',
  bridging: 'Bridging',
  source_diversity: 'Source diversity',
  relevance: 'Relevance',
};

const ROUND_DIFF_EPSILON = 0.0005;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    return candidate.response?.data?.message ?? candidate.message ?? fallback;
  }

  return fallback;
}

function normalizeKeywords(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))
  );
}

function deriveLatestRoundUpdate(epochs: EpochResponse[]): LatestRoundUpdate | null {
  if (epochs.length < 2) {
    return null;
  }

  const sorted = [...epochs].sort((a, b) => b.id - a.id);
  const [current, previous] = sorted;
  if (!current || !previous) {
    return null;
  }

  const weightChanges = (Object.keys(current.weights) as Array<keyof EpochResponse['weights']>)
    .map((key) => {
      const currentValue = current.weights[key];
      const previousValue = previous.weights[key];
      const delta = currentValue - previousValue;
      return {
        key,
        previous: previousValue,
        current: currentValue,
        delta,
      };
    })
    .filter((change) => Math.abs(change.delta) >= ROUND_DIFF_EPSILON);

  const currentRules = current.content_rules ?? { include_keywords: [], exclude_keywords: [] };
  const previousRules = previous.content_rules ?? { include_keywords: [], exclude_keywords: [] };

  const includeCurrent = normalizeKeywords(currentRules.include_keywords);
  const includePreviousList = normalizeKeywords(previousRules.include_keywords);
  const includeCurrentSet = new Set(includeCurrent);
  const includePreviousSet = new Set(includePreviousList);
  const includeAdded = includeCurrent.filter((keyword) => !includePreviousSet.has(keyword));
  const includeRemoved = includePreviousList.filter((keyword) => !includeCurrentSet.has(keyword));

  const excludeCurrent = normalizeKeywords(currentRules.exclude_keywords);
  const excludePreviousList = normalizeKeywords(previousRules.exclude_keywords);
  const excludeCurrentSet = new Set(excludeCurrent);
  const excludePreviousSet = new Set(excludePreviousList);
  const excludeAdded = excludeCurrent.filter((keyword) => !excludePreviousSet.has(keyword));
  const excludeRemoved = excludePreviousList.filter((keyword) => !excludeCurrentSet.has(keyword));

  return {
    currentRoundId: current.id,
    previousRoundId: previous.id,
    participantCount: previous.vote_count,
    appliedAt: current.created_at,
    weightChanges,
    keywordChanges: {
      includeAdded,
      includeRemoved,
      excludeAdded,
      excludeRemoved,
    },
  };
}

export function Dashboard() {
  const { userHandle, logout } = useAuth();
  const { isAdmin } = useAdminStatus();
  const navigate = useNavigate();
  const [stats, setStats] = useState<FeedStatsResponse | null>(null);
  const [epochHistory, setEpochHistory] = useState<EpochResponse[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [topicData, setTopicData] = useState<TopicCatalogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsLoading(true);
      }

      const [statsData, auditData, historyData] = await Promise.all([
        transparencyApi.getStats(),
        transparencyApi.getAuditLog({ limit: 8 }),
        transparencyApi.getEpochHistory(2),
      ]);

      setStats(statsData);
      setAuditLog(auditData.entries);
      setEpochHistory(historyData.epochs);
      setError(null);

      // Load topic catalog (public endpoint, no auth)
      try {
        const catalog = await voteApi.getTopicCatalog();
        setTopicData(catalog);
      } catch {
        // Topic catalog unavailable — skip
      }
    } catch (err: unknown) {
      if (!silent || !hasInitialLoad) {
        setError(getErrorMessage(err, 'Failed to load dashboard data'));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
      setHasInitialLoad(true);
    }
  }, [hasInitialLoad]);

  useEffect(() => {
    void loadData(false);

    const interval = window.setInterval(() => {
      void loadData(true);
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [loadData]);

  const latestRoundUpdate = useMemo(
    () => deriveLatestRoundUpdate(epochHistory),
    [epochHistory]
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAction = (action: string) => {
    return action
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (isLoading && !hasInitialLoad) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="header-content">
            <div className="header-left">
              <h1>Community feed</h1>
              <nav className="header-nav">
                <Link to="/vote" className="nav-link">Vote</Link>
                <Link to="/dashboard" className="nav-link active">Dashboard</Link>
                <Link to="/history" className="nav-link">History</Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="dashboard-main">
          <DashboardSkeleton />
        </main>
        <style>{styles}</style>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="dashboard-page">
        <div className="error-container">
          <h2>Error loading dashboard</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="retry-button">
            Retry
          </button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link">Vote</Link>
              <Link to="/dashboard" className="nav-link active">Dashboard</Link>
              <Link to="/history" className="nav-link">History</Link>
              {isAdmin && <Link to="/admin" className="nav-link">Admin</Link>}
            </nav>
          </div>
          <div className="user-info">
            <span className="user-handle">@{userHandle}</span>
            <button onClick={handleLogout} className="logout-button">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main page-content">
        {stats && (
          <>
            {latestRoundUpdate ? (
              <section className="latest-update-section">
                <div className="section-header">
                  <h2>Latest governance update</h2>
                  <span className="update-time">{formatDate(latestRoundUpdate.appliedAt)}</span>
                </div>
                <p className="latest-update-title">
                  Round {latestRoundUpdate.currentRoundId} is now live.
                </p>
                <p className="latest-update-meta">
                  Applied from Round {latestRoundUpdate.previousRoundId} with {latestRoundUpdate.participantCount} voter(s).
                </p>
                {latestRoundUpdate.weightChanges.length > 0 ? (
                  <div className="latest-update-list">
                    {latestRoundUpdate.weightChanges.map((change) => (
                      <div key={change.key} className="latest-update-item">
                        <span>{WEIGHT_LABELS[change.key]}</span>
                        <strong>
                          {(change.previous * 100).toFixed(1)}% → {(change.current * 100).toFixed(1)}%
                          {' '}
                          ({change.delta >= 0 ? '+' : ''}{(change.delta * 100).toFixed(1)}%)
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="latest-update-empty">No weight changes from the prior round.</p>
                )}
                {(latestRoundUpdate.keywordChanges.includeAdded.length > 0 ||
                  latestRoundUpdate.keywordChanges.excludeAdded.length > 0 ||
                  latestRoundUpdate.keywordChanges.includeRemoved.length > 0 ||
                  latestRoundUpdate.keywordChanges.excludeRemoved.length > 0) && (
                  <div className="latest-keyword-grid">
                    {latestRoundUpdate.keywordChanges.includeAdded.length > 0 && (
                      <div>
                        <span className="keyword-change-label">Include added</span>
                        <p className="keyword-change-values">
                          {latestRoundUpdate.keywordChanges.includeAdded.join(', ')}
                        </p>
                      </div>
                    )}
                    {latestRoundUpdate.keywordChanges.excludeAdded.length > 0 && (
                      <div>
                        <span className="keyword-change-label">Exclude added</span>
                        <p className="keyword-change-values">
                          {latestRoundUpdate.keywordChanges.excludeAdded.join(', ')}
                        </p>
                      </div>
                    )}
                    {latestRoundUpdate.keywordChanges.includeRemoved.length > 0 && (
                      <div>
                        <span className="keyword-change-label">Include removed</span>
                        <p className="keyword-change-values">
                          {latestRoundUpdate.keywordChanges.includeRemoved.join(', ')}
                        </p>
                      </div>
                    )}
                    {latestRoundUpdate.keywordChanges.excludeRemoved.length > 0 && (
                      <div>
                        <span className="keyword-change-label">Exclude removed</span>
                        <p className="keyword-change-values">
                          {latestRoundUpdate.keywordChanges.excludeRemoved.join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <p className="refresh-hint">This page refreshes automatically every minute.</p>
              </section>
            ) : null}

            <section className="weights-section">
              <div className="section-header">
                <h2>Current algorithm weights</h2>
                <span className="epoch-badge">Epoch {stats.epoch.id}</span>
              </div>
              <div className="weights-content">
                <div className="radar-container">
                  <ScoreRadar
                    weights={{
                      recency: stats.epoch.weights.recency,
                      engagement: stats.epoch.weights.engagement,
                      bridging: stats.epoch.weights.bridging,
                      sourceDiversity: stats.epoch.weights.source_diversity,
                      relevance: stats.epoch.weights.relevance,
                    }}
                    showWeights={true}
                    height={280}
                  />
                </div>
                <div className="weights-list">
                  {Object.entries(stats.epoch.weights).map(([key, value]) => (
                    <div key={key} className="weight-item">
                      <span className="weight-name">
                        {key === 'source_diversity' ? 'Source diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
                      </span>
                      <div className="weight-bar-container">
                        <div
                          className="weight-bar"
                          style={{ width: `${value * 100}%` }}
                        />
                      </div>
                      <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {topicData && topicData.topics.length > 0 && (
              <section className="topics-section">
                <div className="section-header">
                  <h2>Community topic preferences</h2>
                  <span className="topic-voter-badge">
                    {topicData.voteCount} topic voter{topicData.voteCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <TopicWeightChart
                  topics={topicData.topics.map((t) => ({
                    slug: t.slug,
                    name: t.name,
                    weight: t.currentWeight,
                  }))}
                  voterCount={topicData.voteCount}
                />
              </section>
            )}

            <section className="stats-section">
              <h2>Feed statistics</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.total_posts_scored.toLocaleString()}</span>
                  <span className="stat-label">Posts scored</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.unique_authors.toLocaleString()}</span>
                  <span className="stat-label">Unique authors</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{(stats.feed_stats.avg_bridging_score * 100).toFixed(1)}%</span>
                  <span className="stat-label">Avg bridging</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.governance.votes_this_epoch}</span>
                  <span className="stat-label">Votes this epoch</span>
                </div>
                {stats.metrics?.author_gini !== null && stats.metrics?.author_gini !== undefined && (
                  <div className="stat-card">
                    <span className="stat-value">{(stats.metrics.author_gini * 100).toFixed(1)}%</span>
                    <span className="stat-label">Author concentration</span>
                  </div>
                )}
              </div>
            </section>

            <section className="audit-section">
              <div className="section-header">
                <h2>Recent governance activity</h2>
                <Link to="/history" className="view-all-link">View all</Link>
              </div>
              <div className="audit-list">
                {auditLog.length === 0 ? (
                  <p className="no-activity">No governance activity yet</p>
                ) : (
                  auditLog.map((entry) => (
                    <div key={entry.id} className="audit-item">
                      <div className="audit-action">{formatAction(entry.action)}</div>
                      <div className="audit-meta">
                        <span className="audit-time">{formatDate(entry.created_at)}</span>
                        {entry.epoch_id && (
                          <span className="audit-epoch">Epoch {entry.epoch_id}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .dashboard-page {
    min-height: 100vh;
    background: var(--bg-app);
  }

  .loading, .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: var(--space-4);
    color: var(--text-secondary);
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-default);
    border-top-color: var(--accent-blue);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-container h2 {
    color: var(--text-primary);
    margin: 0;
  }

  .error-container p {
    color: var(--text-secondary);
  }

  .retry-button {
    background: var(--accent-blue);
    color: white;
    border: none;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-weight: var(--font-weight-semibold);
  }

  .retry-button:hover {
    background: var(--accent-blue-hover);
  }

  .dashboard-header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-default);
    padding: var(--space-4) var(--space-6);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-content {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .dashboard-header h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .header-nav {
    display: flex;
    gap: var(--space-1);
  }

  .nav-link {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    transition: all var(--transition-fast);
  }

  .nav-link:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .nav-link.active {
    color: var(--accent-blue);
    background: var(--accent-blue-subtle);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .user-handle {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .logout-button {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .logout-button:hover {
    background: var(--bg-hover);
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }

  .dashboard-main {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-5);
  }

  .topic-voter-badge {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-elevated);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
  }

  section h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .latest-update-section {
    background: linear-gradient(180deg, rgba(16, 131, 254, 0.1) 0%, rgba(30, 31, 33, 1) 100%);
  }

  .update-time {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .latest-update-title {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
  }

  .latest-update-meta {
    margin: 0 0 var(--space-4) 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .latest-update-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .latest-update-item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.03);
    font-size: var(--text-sm);
  }

  .latest-update-item strong {
    font-variant-numeric: tabular-nums;
    color: var(--accent-blue);
  }

  .latest-update-empty {
    margin: 0 0 var(--space-4) 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .latest-keyword-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .keyword-change-label {
    display: block;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
    margin-bottom: var(--space-1);
  }

  .keyword-change-values {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    word-break: break-word;
  }

  .refresh-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .epoch-badge {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
  }

  .weights-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    align-items: center;
  }

  .radar-container {
    min-height: 280px;
  }

  .weights-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .weight-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .weight-name {
    min-width: 120px;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .weight-bar-container {
    flex: 1;
    height: 6px;
    background: var(--border-default);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .weight-bar {
    height: 100%;
    background: var(--accent-blue);
    border-radius: var(--radius-full);
    transition: width var(--transition-base);
  }

  .weight-value {
    min-width: 40px;
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--accent-blue);
    text-align: right;
  }

  .stats-section h2 {
    margin-bottom: var(--space-5);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-4);
  }

  .stat-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .stat-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-top: var(--space-2);
  }

  .view-all-link {
    color: var(--accent-blue);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
  }

  .view-all-link:hover {
    color: var(--accent-blue-hover);
  }

  .audit-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .no-activity {
    color: var(--text-secondary);
    text-align: center;
    padding: var(--space-6);
  }

  .audit-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
  }

  .audit-action {
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .audit-meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .audit-epoch {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
  }

  @media (max-width: 768px) {
    .header-content {
      flex-direction: column;
      gap: var(--space-4);
    }

    .header-left {
      flex-direction: column;
      gap: var(--space-4);
    }

    .dashboard-main {
      padding: var(--space-4);
    }

    .weights-content {
      grid-template-columns: 1fr;
    }

    .audit-item {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
    }

    .latest-update-item {
      flex-direction: column;
      gap: var(--space-1);
    }
  }
`;

export default Dashboard;

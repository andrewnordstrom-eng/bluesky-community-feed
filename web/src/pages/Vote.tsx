import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { WeightSliders } from '../components/WeightSliders';
import { KeywordInput } from '../components/KeywordInput';
import { TopicSliders } from '../components/TopicSliders';
import { TabPanel } from '../components/TabPanel';
import { VoteSkeleton } from '../components/Skeleton';
import type { GovernanceWeights } from '../components/WeightSliders';
import { voteApi, weightsApi } from '../api/client';
import type { EpochResponse, ContentVote, ContentRulesResponse, TopicCatalogEntry } from '../api/client';

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    return candidate.response?.data?.message ?? candidate.message ?? fallback;
  }

  return fallback;
}

export function Vote() {
  const { isAuthenticated, isLoading: authLoading, userHandle, logout } = useAuth();
  const { isAdmin } = useAdminStatus();
  const navigate = useNavigate();

  const [currentEpoch, setCurrentEpoch] = useState<EpochResponse | null>(null);
  const [weights, setWeights] = useState<GovernanceWeights | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [lastVoteTime, setLastVoteTime] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Content rules state
  const [activeTab, setActiveTab] = useState<'weights' | 'content' | 'topics'>('weights');
  const [contentVote, setContentVote] = useState<ContentVote>({
    includeKeywords: [],
    excludeKeywords: [],
  });
  const [currentContentRules, setCurrentContentRules] = useState<ContentRulesResponse | null>(null);

  // Topic voting state
  const [topicCatalog, setTopicCatalog] = useState<TopicCatalogEntry[] | null>(null);
  const [topicValues, setTopicValues] = useState<Record<string, number>>({});
  const [touchedTopics, setTouchedTopics] = useState<Set<string>>(new Set());

  const currentPhase =
    currentEpoch?.phase ?? (currentEpoch?.status === 'voting' ? 'voting' : 'running');
  const isVotingOpen = currentPhase === 'voting';
  const phaseNotice = useMemo(() => {
    if (!currentEpoch) {
      return null;
    }

    if (currentPhase === 'voting') {
      if (currentEpoch.voting_ends_at) {
        return `Voting is open now and closes ${new Date(currentEpoch.voting_ends_at).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}.`;
      }
      return 'Voting is open now.';
    }

    if (currentPhase === 'results') {
      return 'Voting has closed. Results are being reviewed before they are applied.';
    }

    return 'Voting is currently closed while the current algorithm settings run.';
  }, [currentEpoch, currentPhase]);

  useEffect(() => {
    // Load current epoch and user's vote
    async function loadData() {
      try {
        setIsLoadingData(true);
        setError(null);

        // Get current epoch
        const epoch = await weightsApi.getCurrentEpoch();
        setCurrentEpoch(epoch);

        // Set initial weights to current epoch weights (convert from snake_case)
        setWeights({
          recency: epoch.weights.recency,
          engagement: epoch.weights.engagement,
          bridging: epoch.weights.bridging,
          sourceDiversity: epoch.weights.source_diversity,
          relevance: epoch.weights.relevance,
        });

        // Check if user has voted (if authenticated)
        if (isAuthenticated) {
          try {
            const voteData = await voteApi.getVote();
            if (voteData.vote) {
              setHasVoted(true);
              setLastVoteTime(voteData.voted_at);
              // Use their existing vote as initial weights
              setWeights({
                recency: voteData.vote.recency,
                engagement: voteData.vote.engagement,
                bridging: voteData.vote.bridging,
                sourceDiversity: voteData.vote.sourceDiversity,
                relevance: voteData.vote.relevance,
              });
            }
            // Load user's content vote if exists
            if (voteData.contentVote) {
              setContentVote(voteData.contentVote);
            }
          } catch {
            // User hasn't voted yet
            setHasVoted(false);
          }
        }

        // Load current community content rules
        try {
          const contentRules = await voteApi.getContentRules();
          setCurrentContentRules(contentRules);
        } catch {
          // Content rules endpoint might not exist yet
        }

        // Load topic catalog (graceful degradation: hide topics tab if unavailable)
        try {
          const catalog = await voteApi.getTopicCatalog();
          setTopicCatalog(catalog.topics);
          // If user has existing topic votes, populate them
          if (isAuthenticated) {
            try {
              const voteData = await voteApi.getVote();
              if (voteData.topicWeights && Object.keys(voteData.topicWeights).length > 0) {
                setTopicValues(voteData.topicWeights);
                setTouchedTopics(new Set(Object.keys(voteData.topicWeights)));
              }
            } catch {
              // No existing topic votes
            }
          }
        } catch {
          // Topic catalog unavailable — hide topics tab
          setTopicCatalog(null);
        }
      } catch (err: unknown) {
        setError(extractErrorMessage(err, 'Failed to load data'));
      } finally {
        setIsLoadingData(false);
      }
    }
    void loadData();
  }, [isAuthenticated]);

  // Keep voting phase status fresh without resetting in-progress form edits.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const epoch = await weightsApi.getCurrentEpoch();
          setCurrentEpoch(epoch);
          const contentRules = await voteApi.getContentRules();
          setCurrentContentRules(contentRules);
        } catch {
          // Silent refresh: keep current UI state if refresh fails.
        }
      })();
    }, 45_000);

    return () => window.clearInterval(interval);
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleWeightChange = useCallback((newWeights: GovernanceWeights) => {
    setWeights(newWeights);
    setSuccessMessage(null);
  }, []);

  const handleTopicChange = useCallback((slug: string, value: number) => {
    setTopicValues((prev) => ({ ...prev, [slug]: value }));
    setTouchedTopics((prev) => new Set(prev).add(slug));
    setSuccessMessage(null);
  }, []);

  const handleTopicReset = useCallback(() => {
    setTopicValues({});
    setTouchedTopics(new Set());
    setSuccessMessage(null);
  }, []);

  const handleSubmit = async () => {
    if (!isVotingOpen) {
      setError('Voting is currently closed. Please wait for the next voting period.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Submit based on active tab
      if (activeTab === 'weights') {
        if (!weights) return;
        const result = await voteApi.submitVote(weights, undefined);
        const wasUpdate = hasVoted;
        setHasVoted(true);
        setLastVoteTime(new Date().toISOString());
        setSuccessMessage(
          wasUpdate || result.is_update
            ? 'Your weight vote has been updated!'
            : 'Your weight vote has been recorded! Thank you for participating.'
        );
      } else if (activeTab === 'content') {
        // Submit content vote
        const hasKeywords =
          contentVote.includeKeywords.length > 0 ||
          contentVote.excludeKeywords.length > 0;
        if (!hasKeywords) {
          setError('Please add at least one include or exclude keyword.');
          setIsSubmitting(false);
          return;
        }
        const result = await voteApi.submitVote(null, contentVote);
        setHasVoted(true);
        setLastVoteTime(new Date().toISOString());
        setSuccessMessage(
          result.is_update
            ? 'Your content rules vote has been updated!'
            : 'Your content rules vote has been recorded!'
        );
        // Refresh content rules
        const updatedRules = await voteApi.getContentRules();
        setCurrentContentRules(updatedRules);
      } else if (activeTab === 'topics') {
        // Submit topic weight vote
        if (touchedTopics.size === 0) {
          setError('Please adjust at least one topic preference.');
          setIsSubmitting(false);
          return;
        }
        // Only send touched topics
        const touchedValues: Record<string, number> = {};
        for (const slug of touchedTopics) {
          touchedValues[slug] = topicValues[slug] ?? 0.5;
        }
        const result = await voteApi.submitVote(null, undefined, touchedValues);
        setHasVoted(true);
        setLastVoteTime(new Date().toISOString());

        // Build confirmation message listing boosted/reduced topics
        const boosted: string[] = [];
        const reduced: string[] = [];
        for (const [slug, value] of Object.entries(touchedValues)) {
          const topic = topicCatalog?.find((t) => t.slug === slug);
          const name = topic?.name ?? slug;
          if (value > 0.6) boosted.push(name);
          else if (value < 0.4) reduced.push(name);
        }
        let confirmMsg = result.is_update
          ? 'Your topic preferences have been updated!'
          : 'Your topic preferences have been recorded!';
        if (boosted.length > 0) confirmMsg += ` Boosted: ${boosted.join(', ')}.`;
        if (reduced.length > 0) confirmMsg += ` Reduced: ${reduced.join(', ')}.`;
        setSuccessMessage(confirmMsg);
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to submit vote'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (authLoading || isLoadingData) {
    return (
      <div className="vote-page">
        <header className="vote-header">
          <div className="header-content">
            <div className="header-left">
              <h1>Community feed</h1>
              <nav className="header-nav">
                <Link to="/vote" className="nav-link active">Vote</Link>
                <Link to="/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/history" className="nav-link">History</Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="vote-main">
          <VoteSkeleton />
        </main>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="vote-page">
      <header className="vote-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link active">Vote</Link>
              <Link to="/dashboard" className="nav-link">Dashboard</Link>
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

      <main className="vote-main page-content">
        {currentEpoch && (
          <div className="epoch-info">
            <div className="epoch-status">
              <span className={`status-badge ${currentPhase}`}>
                {currentPhase === 'voting'
                  ? 'Voting open'
                  : currentPhase === 'results'
                    ? 'Results pending'
                    : 'Running'}
              </span>
              <span className="epoch-id">Round {currentEpoch.id}</span>
            </div>
            <div className="vote-count">
              <strong>{currentEpoch.vote_count}</strong> votes
              {currentEpoch.subscriber_count !== undefined && (
                <span className="subscriber-count">
                  {' '}/ {currentEpoch.subscriber_count} subscribers
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <div className="vote-tabs">
          <button
            className={`vote-tab ${activeTab === 'weights' ? 'active' : ''}`}
            onClick={() => setActiveTab('weights')}
          >
            Algorithm Weights
          </button>
          <button
            className={`vote-tab ${activeTab === 'content' ? 'active' : ''}`}
            onClick={() => setActiveTab('content')}
          >
            Content Rules
          </button>
          {topicCatalog && topicCatalog.length > 0 && (
            <button
              className={`vote-tab ${activeTab === 'topics' ? 'active' : ''}`}
              onClick={() => setActiveTab('topics')}
            >
              Topics
            </button>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}
        {phaseNotice ? (
          <div className={`phase-notice ${isVotingOpen ? 'open' : 'closed'}`}>
            {phaseNotice}
          </div>
        ) : null}

        <div className="tab-panel-wrapper">
          {/* Weights tab */}
          <TabPanel isActive={activeTab === 'weights'} tabKey="weights">
            <section className="voting-section">
              <h2>Your vote</h2>
              <p className="vote-description">
                Adjust the sliders to set your preferred algorithm weights. The sliders
                are linked and will always sum to 100%. Your vote will influence how
                the feed ranks posts in future rounds.
              </p>

              {weights && (
                <WeightSliders
                  initialWeights={weights}
                  onChange={handleWeightChange}
                  disabled={isSubmitting}
                />
              )}

              <div className="vote-actions">
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !weights || !isVotingOpen}
                  className="submit-button"
                >
                  {isSubmitting
                    ? 'Submitting...'
                    : hasVoted
                    ? 'Update vote'
                    : 'Submit vote'}
                </button>
                {hasVoted && (
                  <span className="voted-indicator">
                    {lastVoteTime
                      ? `Last voted ${new Date(lastVoteTime).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}. You can update your vote until voting closes.`
                      : 'You have already voted this epoch'}
                  </span>
                )}
              </div>
            </section>
          </TabPanel>

          {/* Content rules tab */}
          <TabPanel isActive={activeTab === 'content'} tabKey="content">
            <section className="voting-section">
              <h2>Content rules vote</h2>
              <p className="vote-description">
                Vote on keywords to include or exclude from the feed. Keywords appearing
                in at least 30% of votes will become active rules for the next epoch.
              </p>

              <KeywordInput
                label="Include keywords"
                description="Posts containing any of these keywords will be prioritized. Leave empty for no preference."
                keywords={contentVote.includeKeywords}
                onChange={(keywords) =>
                  setContentVote((prev) => ({ ...prev, includeKeywords: keywords }))
                }
                disabled={isSubmitting}
                variant="include"
                placeholder="Type a keyword and press Enter (e.g., AI, research)"
              />

              <KeywordInput
                label="Exclude keywords"
                description="Posts containing any of these keywords will be filtered out. Leave empty for no exclusions."
                keywords={contentVote.excludeKeywords}
                onChange={(keywords) =>
                  setContentVote((prev) => ({ ...prev, excludeKeywords: keywords }))
                }
                disabled={isSubmitting}
                variant="exclude"
                placeholder="Type a keyword and press Enter (e.g., spam, crypto)"
              />

              <div className="vote-actions">
                <button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    (contentVote.includeKeywords.length === 0 &&
                      contentVote.excludeKeywords.length === 0)
                  }
                  className="submit-button"
                >
                  {isSubmitting
                    ? 'Submitting...'
                    : hasVoted
                    ? 'Update content vote'
                    : 'Submit content vote'}
                </button>
                {hasVoted && lastVoteTime && (
                  <span className="voted-indicator">
                    Last voted {new Date(lastVoteTime).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>

              {/* Current community content rules */}
              {currentContentRules && (
                <div className="current-content-rules">
                  <h3>Current community rules</h3>
                  <p className="rules-description">
                    These rules are active based on {currentContentRules.total_voters} voter(s).
                    Keywords need {currentContentRules.threshold}+ votes to be included.
                  </p>
                  {currentContentRules.include_keywords.length > 0 && (
                    <div className="rules-group">
                      <span className="rules-label">Include:</span>
                      <div className="rules-keywords">
                        {currentContentRules.include_keywords.map((kw) => (
                          <span key={kw} className="rule-keyword include">
                            {kw}
                            <span className="keyword-votes">
                              ({currentContentRules.include_keyword_votes[kw] || 0})
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentContentRules.exclude_keywords.length > 0 && (
                    <div className="rules-group">
                      <span className="rules-label">Exclude:</span>
                      <div className="rules-keywords">
                        {currentContentRules.exclude_keywords.map((kw) => (
                          <span key={kw} className="rule-keyword exclude">
                            {kw}
                            <span className="keyword-votes">
                              ({currentContentRules.exclude_keyword_votes[kw] || 0})
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentContentRules.include_keywords.length === 0 &&
                    currentContentRules.exclude_keywords.length === 0 && (
                      <p className="no-rules">No content rules active yet.</p>
                    )}
                </div>
              )}
            </section>
          </TabPanel>

          {/* Topics tab */}
          {topicCatalog && topicCatalog.length > 0 && (
            <TabPanel isActive={activeTab === 'topics'} tabKey="topics">
              <section className="voting-section">
                <h2>Topic preferences</h2>
                <p className="vote-description">
                  Which topics should the feed prioritize? Move sliders to boost
                  topics you want more of, or reduce topics you want less of.
                </p>

                <TopicSliders
                  topics={topicCatalog}
                  values={topicValues}
                  onChange={handleTopicChange}
                  onReset={handleTopicReset}
                  touchedSlugs={touchedTopics}
                  disabled={isSubmitting}
                />

                <div className="vote-actions">
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || touchedTopics.size === 0 || !isVotingOpen}
                    className="submit-button"
                  >
                    {isSubmitting
                      ? 'Submitting...'
                      : hasVoted
                      ? 'Update topic vote'
                      : 'Submit topic vote'}
                  </button>
                  {hasVoted && lastVoteTime && (
                    <span className="voted-indicator">
                      Last voted {new Date(lastVoteTime).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </section>
            </TabPanel>
          )}
        </div>

        <section className="current-weights-section">
          <h2>Current algorithm weights</h2>
          <p className="section-description">
            These are the weights currently being used by the feed algorithm,
            determined by community votes from the previous epoch.
          </p>
          {currentEpoch && (
            <div className="current-weights-grid">
              {Object.entries(currentEpoch.weights).map(([key, value]) => (
                <div key={key} className="weight-card">
                  <span className="weight-name">
                    {key === 'source_diversity' ? 'Source diversity' : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}
                  </span>
                  <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .vote-page {
    min-height: 100vh;
    background: var(--bg-app);
  }

  .loading {
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

  .vote-header {
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

  .vote-header h1 {
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

  .vote-main {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6);
    position: relative;
  }

  .epoch-info {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-6);
    margin-bottom: var(--space-6);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .epoch-status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .status-badge {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
  }

  .status-badge.active {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
  }

  .status-badge.running {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
  }

  .status-badge.voting {
    background: rgba(52, 199, 89, 0.15);
    color: var(--status-success);
  }

  .status-badge.results {
    background: rgba(255, 159, 10, 0.16);
    color: #ff9f0a;
  }

  .epoch-id {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .vote-count {
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .subscriber-count {
    color: var(--text-secondary);
  }

  .vote-tabs {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
  }

  .vote-tab {
    flex: 1;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .vote-tab:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .vote-tab.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
  }

  .voting-section, .current-weights-section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .voting-section h2, .current-weights-section h2 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
  }

  .vote-description, .section-description {
    color: var(--text-secondary);
    margin-bottom: var(--space-6);
    line-height: var(--leading-relaxed);
    font-size: var(--text-base);
  }

  .error-message {
    background: rgba(255, 69, 58, 0.1);
    border: 1px solid rgba(255, 69, 58, 0.2);
    color: var(--status-error);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .success-message {
    background: rgba(52, 199, 89, 0.1);
    border: 1px solid rgba(52, 199, 89, 0.2);
    color: var(--status-success);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .phase-notice {
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .phase-notice.open {
    background: rgba(52, 199, 89, 0.1);
    border: 1px solid rgba(52, 199, 89, 0.2);
    color: var(--status-success);
  }

  .phase-notice.closed {
    background: rgba(255, 159, 10, 0.12);
    border: 1px solid rgba(255, 159, 10, 0.2);
    color: #ff9f0a;
  }

  .vote-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }

  .submit-button {
    background: var(--accent-blue);
    color: white;
    border: none;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .submit-button:hover:not(:disabled) {
    background: var(--accent-blue-hover);
  }

  .submit-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voted-indicator {
    color: var(--status-success);
    font-size: var(--text-sm);
  }

  .current-weights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-4);
  }

  .weight-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    text-align: center;
  }

  .weight-name {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }

  .weight-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  /* Content rules styles */
  .current-content-rules {
    margin-top: var(--space-8);
    padding-top: var(--space-6);
    border-top: 1px solid var(--border-default);
  }

  .current-content-rules h3 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .rules-description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-4);
  }

  .rules-group {
    margin-bottom: var(--space-3);
  }

  .rules-label {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }

  .rules-keywords {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .rule-keyword {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
  }

  .rule-keyword.include {
    background: rgba(52, 199, 89, 0.15);
    color: #34c759;
  }

  .rule-keyword.exclude {
    background: rgba(255, 69, 58, 0.15);
    color: #ff453a;
  }

  .keyword-votes {
    font-size: var(--text-xs);
    opacity: 0.7;
  }

  .no-rules {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-style: italic;
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

    .vote-main {
      padding: var(--space-4);
    }

    .epoch-info {
      flex-direction: column;
      gap: var(--space-3);
      text-align: center;
    }

    .vote-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .voted-indicator {
      text-align: center;
    }
  }
`;

export default Vote;

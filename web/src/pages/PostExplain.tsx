import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ScoreRadar } from '../components/ScoreRadar';
import { transparencyApi } from '../api/client';
import type { PostExplanationResponse } from '../api/client';

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

export function PostExplain() {
  const { uri } = useParams<{ uri: string }>();
  const [explanation, setExplanation] = useState<PostExplanationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExplanation() {
      if (!uri) return;

      try {
        setIsLoading(true);
        setError(null);
        const data = await transparencyApi.getPostExplanation(uri);
        setExplanation(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to load post explanation'));
      } finally {
        setIsLoading(false);
      }
    }

    loadExplanation();
  }, [uri]);

  if (isLoading) {
    return (
      <div className="post-explain-page">
        <div className="loading">
          <div className="loading-spinner" />
          <span>Loading explanation...</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="post-explain-page">
        <div className="error-container">
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/dashboard" className="back-link">Back to dashboard</Link>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!explanation) return null;

  const rankDiff = explanation.counterfactual.difference;
  const rankDirection = rankDiff > 0 ? 'higher' : rankDiff < 0 ? 'lower' : 'same';

  return (
    <div className="post-explain-page">
      <header className="explain-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link">Vote</Link>
              <Link to="/dashboard" className="nav-link">Dashboard</Link>
              <Link to="/history" className="nav-link">History</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="explain-main">
        <div className="page-title">
          <Link to="/dashboard" className="back-link">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1L4 8l7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </Link>
          <h2>Post score explanation</h2>
        </div>

        <section className="overview-section">
          <div className="overview-card">
            <span className="overview-label">Current rank</span>
            <span className="overview-value">#{explanation.rank}</span>
          </div>
          <div className="overview-card">
            <span className="overview-label">Total score</span>
            <span className="overview-value">{(explanation.total_score * 100).toFixed(1)}</span>
          </div>
          <div className="overview-card">
            <span className="overview-label">Epoch</span>
            <span className="overview-value">{explanation.epoch_id}</span>
          </div>
        </section>

        <section className="radar-section">
          <h3>Score components</h3>
          <div className="radar-container">
            <ScoreRadar
              scores={{
                recency: explanation.components.recency.raw_score,
                engagement: explanation.components.engagement.raw_score,
                bridging: explanation.components.bridging.raw_score,
                sourceDiversity: explanation.components.source_diversity.raw_score,
                relevance: explanation.components.relevance.raw_score,
              }}
              weights={{
                recency: explanation.governance_weights.recency,
                engagement: explanation.governance_weights.engagement,
                bridging: explanation.governance_weights.bridging,
                sourceDiversity: explanation.governance_weights.source_diversity,
                relevance: explanation.governance_weights.relevance,
              }}
              showWeights={true}
              height={350}
            />
          </div>
        </section>

        <section className="breakdown-section">
          <h3>Score breakdown</h3>
          <table className="score-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Raw score</th>
                <th>Weight</th>
                <th>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(explanation.components).map(([key, component]) => (
                <tr key={key}>
                  <td className="component-name">
                    {key === 'source_diversity' ? 'Source diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
                  </td>
                  <td className="score-cell">{(component.raw_score * 100).toFixed(1)}%</td>
                  <td className="weight-cell">{(component.weight * 100).toFixed(0)}%</td>
                  <td className="contribution-cell">
                    <div className="contribution-bar-container">
                      <div
                        className="contribution-bar"
                        style={{ width: `${(component.weighted / explanation.total_score) * 100}%` }}
                      />
                    </div>
                    <span className="contribution-value">{(component.weighted * 100).toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Total score</strong></td>
                <td><strong>{(explanation.total_score * 100).toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>

        {explanation.components.relevance.topicBreakdown &&
          Object.keys(explanation.components.relevance.topicBreakdown).length > 0 && (
          <section className="topics-breakdown-section">
            <h3>Topic matches</h3>
            <p className="topics-hint">
              Shows which topics were detected in this post and their community weight.
            </p>
            <table className="topic-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Match</th>
                  <th>Community weight</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(explanation.components.relevance.topicBreakdown!)
                  .sort(([, a], [, b]) => b.contribution - a.contribution)
                  .map(([slug, entry]) => {
                    const name = slug
                      .split('-')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ');
                    const isAboveNeutral = entry.communityWeight > 0.5;
                    const isBelowNeutral = entry.communityWeight < 0.5;
                    return (
                      <tr key={slug}>
                        <td className="topic-name-cell">{name}</td>
                        <td className="topic-match-cell">
                          {(entry.postScore * 100).toFixed(0)}%
                        </td>
                        <td className="topic-weight-cell">
                          <div className="topic-weight-bar-container">
                            <div
                              className={`topic-weight-bar ${
                                isAboveNeutral ? 'boost' : isBelowNeutral ? 'penalize' : 'neutral'
                              }`}
                              style={{
                                width: `${entry.communityWeight * 100}%`,
                              }}
                            />
                          </div>
                          <span className={`topic-weight-value ${
                            isAboveNeutral ? 'boost' : isBelowNeutral ? 'penalize' : ''
                          }`}>
                            {(entry.communityWeight * 100).toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
        )}

        <section className="counterfactual-section">
          <h3>Governance impact</h3>
          <div className="counterfactual-content">
            <p className="counterfactual-description">
              Without community governance (pure engagement ranking), this post would be ranked{' '}
              <strong>#{explanation.counterfactual.pure_engagement_rank}</strong>.
              Community voting has moved it{' '}
              <strong className={`rank-change ${rankDirection}`}>
                {rankDiff === 0
                  ? 'no positions'
                  : `${Math.abs(rankDiff)} position${Math.abs(rankDiff) !== 1 ? 's' : ''} ${
                      rankDiff > 0 ? 'up' : 'down'
                    }`}
              </strong>
              .
            </p>
            <div className="rank-comparison">
              <div className="rank-box">
                <span className="rank-box-label">Pure engagement</span>
                <span className="rank-box-value">#{explanation.counterfactual.pure_engagement_rank}</span>
              </div>
              <div className="rank-arrow">
                {rankDiff > 0 ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                ) : rankDiff < 0 ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12l7 7 7-7"/>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14"/>
                  </svg>
                )}
                <span className="rank-diff">{Math.abs(rankDiff)}</span>
              </div>
              <div className="rank-box current">
                <span className="rank-box-label">Community governed</span>
                <span className="rank-box-value">#{explanation.rank}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="post-uri-section">
          <h3>Post details</h3>
          <div className="detail-row">
            <span className="detail-label">AT URI</span>
            <code className="detail-value">{explanation.post_uri}</code>
          </div>
          <div className="detail-row">
            <span className="detail-label">Last scored</span>
            <span className="detail-value">
              {new Date(explanation.scored_at).toLocaleString()}
            </span>
          </div>
        </section>
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .post-explain-page {
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

  .explain-header {
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

  .explain-header h1 {
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

  .explain-main {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .page-title {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .page-title h2 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    transition: color var(--transition-fast);
  }

  .back-link:hover {
    color: var(--accent-blue);
  }

  section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  section h3 {
    margin: 0 0 var(--space-5) 0;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .overview-section {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .overview-card {
    padding: var(--space-5);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    text-align: center;
  }

  .overview-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }

  .overview-value {
    display: block;
    font-size: var(--text-3xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .radar-container {
    display: flex;
    justify-content: center;
  }

  .score-table {
    width: 100%;
    border-collapse: collapse;
  }

  .score-table th, .score-table td {
    padding: var(--space-4);
    text-align: left;
    border-bottom: 1px solid var(--border-default);
    color: var(--text-primary);
  }

  .score-table th {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: var(--font-weight-semibold);
  }

  .component-name {
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
  }

  .score-cell, .weight-cell {
    color: var(--text-primary);
  }

  .contribution-cell {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .contribution-bar-container {
    flex: 1;
    height: 6px;
    background: var(--border-default);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .contribution-bar {
    height: 100%;
    background: var(--accent-blue);
    border-radius: var(--radius-full);
  }

  .contribution-value {
    min-width: 48px;
    text-align: right;
    font-weight: var(--font-weight-medium);
  }

  .score-table tfoot td {
    border-bottom: none;
    font-weight: var(--font-weight-semibold);
  }

  .topics-breakdown-section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .topics-hint {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0 0 var(--space-4) 0;
  }

  .topic-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .topic-table th {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .topic-table td {
    padding: var(--space-3);
    border-bottom: 1px solid rgba(58, 58, 60, 0.5);
  }

  .topic-name-cell {
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
  }

  .topic-match-cell {
    color: var(--text-secondary);
  }

  .topic-weight-cell {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .topic-weight-bar-container {
    flex: 1;
    height: 6px;
    background: var(--border-default);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .topic-weight-bar {
    height: 100%;
    border-radius: var(--radius-full);
  }

  .topic-weight-bar.boost {
    background: var(--status-success);
  }

  .topic-weight-bar.penalize {
    background: var(--status-error);
  }

  .topic-weight-bar.neutral {
    background: var(--text-secondary);
  }

  .topic-weight-value {
    min-width: 36px;
    text-align: right;
    font-weight: var(--font-weight-medium);
  }

  .topic-weight-value.boost {
    color: var(--status-success);
  }

  .topic-weight-value.penalize {
    color: var(--status-error);
  }

  .counterfactual-description {
    margin: 0 0 var(--space-6) 0;
    line-height: var(--leading-relaxed);
    color: var(--text-secondary);
  }

  .rank-change.higher {
    color: var(--status-success);
  }

  .rank-change.lower {
    color: var(--status-error);
  }

  .rank-change.same {
    color: var(--text-secondary);
  }

  .rank-comparison {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
  }

  .rank-box {
    padding: var(--space-5) var(--space-6);
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    text-align: center;
    min-width: 160px;
  }

  .rank-box.current {
    background: var(--accent-blue);
    color: white;
  }

  .rank-box-label {
    display: block;
    font-size: var(--text-xs);
    opacity: 0.8;
  }

  .rank-box-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    margin-top: var(--space-2);
  }

  .rank-arrow {
    color: var(--accent-blue);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .rank-diff {
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
  }

  .detail-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border-default);
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .detail-label {
    min-width: 100px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .detail-value {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--text-primary);
    word-break: break-all;
  }

  code.detail-value {
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
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

    .explain-main {
      padding: var(--space-4);
    }

    .page-title {
      flex-direction: column;
      align-items: flex-start;
    }

    .overview-section {
      grid-template-columns: 1fr;
    }

    .rank-comparison {
      flex-direction: column;
      gap: var(--space-4);
    }

    .detail-row {
      flex-direction: column;
      gap: var(--space-2);
    }
  }
`;

export default PostExplain;

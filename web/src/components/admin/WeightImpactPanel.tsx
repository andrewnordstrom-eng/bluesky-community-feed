import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type WeightImpactPost, type WeightImpactResponse } from '../../api/admin';

const COMPONENT_LABELS: Record<string, string> = {
  recency: 'Recency',
  engagement: 'Engagement',
  bridging: 'Bridging',
  sourceDiversity: 'Source Diversity',
  relevance: 'Relevance',
};

interface MessageState {
  type: 'success' | 'error';
  text: string;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function componentRows(post: WeightImpactPost) {
  return [
    { key: 'recency', ...post.components.recency },
    { key: 'engagement', ...post.components.engagement },
    { key: 'bridging', ...post.components.bridging },
    { key: 'sourceDiversity', ...post.components.sourceDiversity },
    { key: 'relevance', ...post.components.relevance },
  ] as const;
}

export function WeightImpactPanel() {
  const [data, setData] = useState<WeightImpactResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<MessageState | null>(null);

  const fetchImpact = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminApi.getWeightImpact(20);
      setData(response);
      setMessage(null);
    } catch (error) {
      setData(null);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to load weight impact analysis',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadImpact() {
      setIsLoading(true);
      try {
        const response = await adminApi.getWeightImpact(20);
        setData(response);
        setMessage(null);
      } catch (error) {
        setData(null);
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to load weight impact analysis',
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadImpact();
  }, []);

  const sensitivityRows = useMemo(() => {
    if (!data) {
      return [];
    }

    return Object.entries(data.weightSensitivity)
      .map(([key, value]) => ({
        key,
        label: COMPONENT_LABELS[key] ?? key,
        postsAffected: value.postsAffected,
        avgRankChange: value.avgRankChange,
      }))
      .sort((a, b) => b.postsAffected - a.postsAffected);
  }, [data]);

  const topPost = data?.topPosts[0] ?? null;

  return (
    <div className="admin-card">
      <div className="weight-impact-header">
        <h2>Weight Impact Analysis</h2>
        <button type="button" className="btn-secondary" onClick={() => void fetchImpact()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {message ? <div className={`alert alert-${message.type}`}>{message.text}</div> : null}

      {isLoading && !data ? (
        <p className="empty-state">Loading weight impact analysis...</p>
      ) : null}

      {!isLoading && data ? (
        <>
          <div className="weight-impact-summary">
            <div className="stat-row">
              <span>Current weights</span>
              <strong>
                {formatPercent(data.currentWeights.recency)} recency, {formatPercent(data.currentWeights.engagement)}
                {' '}engagement, {formatPercent(data.currentWeights.bridging)} bridging,{' '}
                {formatPercent(data.currentWeights.sourceDiversity)} diversity, {formatPercent(data.currentWeights.relevance)} relevance
              </strong>
            </div>
            <div className="stat-row">
              <span>Analyzed posts</span>
              <strong>{data.analyzedPosts}</strong>
            </div>
          </div>

          {topPost ? (
            <div className="impact-top-explain">
              <h3>Why Is This Post #1?</h3>
              <p className="impact-post-title">{topPost.textPreview ?? topPost.uri}</p>
              <p className="impact-post-meta">
                Dominant factor: <strong>{COMPONENT_LABELS[topPost.dominantFactor]}</strong>. With equal weights this would rank #{topPost.wouldRankWithEqualWeights}.
              </p>
            </div>
          ) : null}

          <div className="impact-post-list">
            {data.topPosts.slice(0, 5).map((post) => {
              const rows = componentRows(post);
              return (
                <div key={post.uri} className="impact-post-card">
                  <div className="impact-post-card-header">
                    <span className="impact-rank">#{post.rank}</span>
                    <span className="impact-score">Score {post.totalScore.toFixed(4)}</span>
                  </div>
                  <p className="impact-post-title">{post.textPreview ?? post.uri}</p>

                  {rows.map((row) => {
                    const contribution = post.totalScore > 0 ? (row.weighted / post.totalScore) * 100 : 0;
                    return (
                      <div key={`${post.uri}-${row.key}`} className="impact-row">
                        <span className="impact-label">{COMPONENT_LABELS[row.key]}</span>
                        <div className="impact-bar-container">
                          <div className="impact-bar" style={{ width: `${Math.max(0, Math.min(100, contribution))}%` }} />
                        </div>
                        <span className="impact-value">{Math.round(contribution)}%</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="impact-sensitivity">
            <h3>Weight Sensitivity (±10%)</h3>
            {sensitivityRows.map((row) => (
              <div key={row.key} className="stat-row">
                <span>{row.label}</span>
                <strong>
                  {row.postsAffected} posts affected, avg rank change {row.avgRankChange.toFixed(2)}
                </strong>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

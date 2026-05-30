import { useCallback, useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { FeedHealth as FeedHealthType } from '../../api/admin';
import { formatNumber, formatRelative, formatDate } from '../../utils/format';
import { AdminPanelSkeleton } from '../Skeleton';

export function FeedHealth() {
  const [health, setHealth] = useState<FeedHealthType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRescoring, setIsRescoring] = useState(false);
  const [isReconnectingJetstream, setIsReconnectingJetstream] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await adminApi.getFeedHealth();
      setHealth(data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load feed health' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let inFlight = false;
    async function loadHealth() {
      if (!isMounted || inFlight) return;
      inFlight = true;
      try {
        const data = await adminApi.getFeedHealth();
        if (!isMounted) return;
        setHealth(data);
      } catch {
        if (!isMounted) return;
        setMessage({ type: 'error', text: 'Failed to load feed health' });
      } finally {
        if (isMounted) setIsLoading(false);
        inFlight = false;
      }
    }
    void loadHealth();

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      void loadHealth();
    }, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  async function handleRescore() {
    setIsRescoring(true);
    setMessage(null);

    try {
      await adminApi.triggerRescore();
      setMessage({ type: 'success', text: 'Scoring started. Refreshing in 5 seconds...' });

      // Refresh after delay
      setTimeout(() => {
        fetchHealth();
        setIsRescoring(false);
        setMessage({ type: 'success', text: 'Scoring complete!' });
      }, 5000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to trigger rescore' });
      setIsRescoring(false);
    }
  }

  async function handleJetstreamReconnect() {
    setIsReconnectingJetstream(true);
    setMessage(null);

    try {
      await adminApi.triggerJetstreamReconnect();
      setMessage({ type: 'success', text: 'Jetstream reconnect triggered. Refreshing status...' });
      setTimeout(() => {
        fetchHealth();
        setIsReconnectingJetstream(false);
      }, 2000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to trigger Jetstream reconnect' });
      setIsReconnectingJetstream(false);
    }
  }

  if (isLoading || !health) {
    return <AdminPanelSkeleton />;
  }

  return (
    <div className="content-loaded">
      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Database Stats */}
      <div className="admin-card">
        <h2>Database</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Total Posts</div>
            <div className="stat-number">{formatNumber(health.database.totalPosts)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Last 24h</div>
            <div className="stat-number">{formatNumber(health.database.postsLast24h)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Last 7d</div>
            <div className="stat-number">{formatNumber(health.database.postsLast7d)}</div>
          </div>
        </div>
        <div className="section-divider" />
        <div className="stat-row">
          <span>Oldest post</span>
          <strong>{health.database.oldestPost ? formatDate(health.database.oldestPost) : 'N/A'}</strong>
        </div>
        <div className="stat-row">
          <span>Newest post</span>
          <strong>
            {health.database.newestPost
              ? formatRelative(health.database.newestPost)
              : 'N/A'}
          </strong>
        </div>
      </div>

      {/* Scoring Pipeline */}
      <div className="admin-card">
        <h2>Scoring Pipeline</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Posts Scored</div>
            <div className="stat-number">{health.scoring.postsScored}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Posts Filtered</div>
            <div className="stat-number">{formatNumber(health.scoring.postsFiltered)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Duration</div>
            <div className="stat-number">
              {health.scoring.lastRunDuration ? `${health.scoring.lastRunDuration}ms` : '—'}
            </div>
          </div>
        </div>
        <div className="section-divider" />
        <div className="stat-row">
          <span>Last run</span>
          <strong>{health.scoring.lastRun ? formatRelative(health.scoring.lastRun) : 'Never'}</strong>
        </div>
        <button
          className="btn-secondary"
          style={{ marginTop: '16px' }}
          onClick={handleRescore}
          disabled={isRescoring}
        >
          {isRescoring ? 'Scoring...' : 'Force Re-score Now'}
        </button>
      </div>

      {/* Jetstream Connection */}
      <div className="admin-card">
        <h2>Jetstream Connection</h2>
        <div className="connection-status">
          <span className={`status-indicator ${health.jetstream.connected ? 'connected' : 'disconnected'}`} />
          <span style={{ color: '#f1f3f5' }}>
            {health.jetstream.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        {!health.jetstream.connected && typeof health.jetstream.disconnectedForSeconds === 'number' && (
          <div className="stat-row">
            <span>Disconnected for</span>
            <strong>{Math.floor(health.jetstream.disconnectedForSeconds / 60)}m</strong>
          </div>
        )}
        <div className="stat-row">
          <span>Last event</span>
          <strong>{health.jetstream.lastEvent ? formatRelative(health.jetstream.lastEvent) : 'Unknown'}</strong>
        </div>
        <div className="stat-row">
          <span>Events (5 min)</span>
          <strong>{health.jetstream.eventsLast5min}</strong>
        </div>
        <button
          className="btn-secondary"
          style={{ marginTop: '16px' }}
          onClick={handleJetstreamReconnect}
          disabled={isReconnectingJetstream}
        >
          {isReconnectingJetstream ? 'Reconnecting...' : 'Reconnect Jetstream'}
        </button>
      </div>

      {/* Subscribers */}
      <div className="admin-card">
        <h2>Subscribers</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Total</div>
            <div className="stat-number">{health.subscribers.total}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">With Votes</div>
            <div className="stat-number">{health.subscribers.withVotes}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Active (7d)</div>
            <div className="stat-number">{health.subscribers.activeLastWeek}</div>
          </div>
        </div>
      </div>

      {/* Content Rules */}
      <div className="admin-card">
        <h2>Active Content Rules</h2>
        <div className="keyword-section">
          <label>Include keywords:</label>
          <div className="keyword-pills">
            {health.contentRules?.includeKeywords?.length > 0 ? (
              health.contentRules.includeKeywords.map(k => (
                <span key={k} className="pill pill-include">{k}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
        <div className="keyword-section">
          <label>Exclude keywords:</label>
          <div className="keyword-pills">
            {health.contentRules?.excludeKeywords?.length > 0 ? (
              health.contentRules.excludeKeywords.map(k => (
                <span key={k} className="pill pill-exclude">{k}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
        {health.contentRules?.lastUpdated && (
          <p className="help-text" style={{ marginTop: '12px' }}>
            Last updated: {formatRelative(health.contentRules.lastUpdated)}
          </p>
        )}
      </div>
    </div>
  );
}

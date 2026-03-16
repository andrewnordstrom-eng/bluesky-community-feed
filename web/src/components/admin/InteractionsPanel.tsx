/**
 * Interactions Panel — Admin Dashboard Tab
 *
 * Displays feed interaction tracking data:
 * - Summary cards (today vs yesterday comparison)
 * - Feed loads over time (7-day trend)
 * - Scroll depth distribution
 * - Engagement attribution by position
 * - Epoch comparison chart
 * - Keyword performance table
 */

import { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { adminApi } from '../../api/admin';
import type {
  InteractionOverview,
  ScrollDepthData,
  EngagementData,
  EpochComparisonData,
  KeywordPerformanceData,
} from '../../api/admin';
import { AdminPanelSkeleton } from '../Skeleton';

export function InteractionsPanel() {
  const [overview, setOverview] = useState<InteractionOverview | null>(null);
  const [scrollDepth, setScrollDepth] = useState<ScrollDepthData | null>(null);
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [epochComparison, setEpochComparison] = useState<EpochComparisonData | null>(null);
  const [keywordPerf, setKeywordPerf] = useState<KeywordPerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchAll() {
    try {
      const [ov, sd, eg, ec, kp] = await Promise.all([
        adminApi.getInteractionOverview(),
        adminApi.getScrollDepth(),
        adminApi.getEngagement(),
        adminApi.getEpochComparison(),
        adminApi.getKeywordPerformance(),
      ]);
      setOverview(ov);
      setScrollDepth(sd);
      setEngagement(eg);
      setEpochComparison(ec);
      setKeywordPerf(kp);
      setError(null);
    } catch {
      setError('Failed to load interaction data');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return <AdminPanelSkeleton />;
  }

  if (error) {
    return (
      <div className="content-loaded">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="content-loaded">
      {/* Summary Cards */}
      {overview && <SummaryCards overview={overview} />}

      {/* Feed Loads Over Time */}
      {overview && overview.trend.length > 0 && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <h3>Feed Loads (7-Day Trend)</h3>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <AreaChart data={overview.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2d" />
                <XAxis
                  dataKey="date"
                  stroke="#787c7e"
                  fontSize={12}
                  tickFormatter={(d) => new Date(String(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis stroke="#787c7e" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#1e1f21', border: '1px solid #2a2b2d', borderRadius: '8px' }}
                  labelFormatter={(d) => new Date(String(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                />
                <Area
                  type="monotone"
                  dataKey="totalRequests"
                  stroke="#1083fe"
                  fill="#1083fe"
                  fillOpacity={0.15}
                  name="Total Loads"
                />
                <Area
                  type="monotone"
                  dataKey="uniqueViewers"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.1}
                  name="Unique Viewers"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Scroll Depth Distribution */}
      {scrollDepth && scrollDepth.histogram.length > 0 && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <h3>Scroll Depth Distribution</h3>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={scrollDepth.histogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2d" />
                <XAxis dataKey="bucket" stroke="#787c7e" fontSize={12} />
                <YAxis stroke="#787c7e" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#1e1f21', border: '1px solid #2a2b2d', borderRadius: '8px' }}
                />
                <Bar dataKey="sessionCount" fill="#1083fe" name="Sessions" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Engagement Attribution */}
      {engagement && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <h3>Engagement Attribution</h3>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <div className="stat-item">
              <span className="stat-label">Posts Served</span>
              <span className="stat-number">{engagement.overall.totalServed.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Posts Engaged</span>
              <span className="stat-number">{engagement.overall.totalEngaged.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Engagement Rate</span>
              <span className="stat-number">{(engagement.overall.engagementRate * 100).toFixed(1)}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Likes / Reposts</span>
              <span className="stat-number">{engagement.overall.likes} / {engagement.overall.reposts}</span>
            </div>
          </div>
          {engagement.byPosition.length > 0 && (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={engagement.byPosition}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2d" />
                  <XAxis dataKey="bucket" stroke="#787c7e" fontSize={12} />
                  <YAxis stroke="#787c7e" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: '#1e1f21', border: '1px solid #2a2b2d', borderRadius: '8px' }}
                  />
                  <Bar dataKey="served" fill="#2a2b2d" name="Served" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="engaged" fill="#10b981" name="Engaged" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Epoch Comparison */}
      {epochComparison && epochComparison.epochs.length > 1 && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <h3>Engagement Rate by Epoch</h3>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={epochComparison.epochs}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2d" />
                <XAxis
                  dataKey="epochId"
                  stroke="#787c7e"
                  fontSize={12}
                  tickFormatter={(id) => `Epoch ${id}`}
                />
                <YAxis
                  stroke="#787c7e"
                  fontSize={12}
                  tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                />
                <Tooltip
                  contentStyle={{ background: '#1e1f21', border: '1px solid #2a2b2d', borderRadius: '8px' }}
                  formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                  labelFormatter={(id) => `Epoch ${id}`}
                />
                <ReferenceLine y={0} stroke="#2a2b2d" />
                <Line
                  type="monotone"
                  dataKey="engagementRate"
                  stroke="#1083fe"
                  strokeWidth={2}
                  dot={{ fill: '#1083fe', r: 4 }}
                  name="Engagement Rate"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Keyword Performance */}
      {keywordPerf && keywordPerf.keywords.length > 0 && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <h3>Keyword Performance</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2b2d' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#787c7e' }}>Keyword</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#787c7e' }}>Served</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#787c7e' }}>Engaged</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#787c7e' }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {keywordPerf.keywords.map((kw) => (
                  <tr key={kw.keyword} style={{ borderBottom: '1px solid #2a2b2d' }}>
                    <td style={{ padding: '0.5rem', color: '#f1f3f5' }}>{kw.keyword}</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: '#f1f3f5' }}>{kw.served}</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: '#f1f3f5' }}>{kw.engaged}</td>
                    <td style={{
                      textAlign: 'right',
                      padding: '0.5rem',
                      color: kw.rate === 0 ? '#f59e0b' : '#10b981',
                    }}>
                      {(kw.rate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {overview && overview.today.totalRequests === 0 && (!scrollDepth || scrollDepth.histogram.length === 0) && (
        <div className="admin-card" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: '#787c7e', fontSize: '1.1rem' }}>
            No interaction data yet. Data will appear after feed requests are processed.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Summary cards row with today vs yesterday comparison.
 */
type DeltaProps = {
  current: number;
  previous: number | undefined;
};

function Delta({ current, previous }: DeltaProps) {
  if (previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const color = pct >= 0 ? '#10b981' : '#ef4444';
  const arrow = pct >= 0 ? '▲' : '▼';
  return (
    <span style={{ fontSize: '0.75rem', color, marginLeft: '0.4rem' }}>
      {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function SummaryCards({ overview }: { overview: InteractionOverview }) {
  const { today, yesterday } = overview;

  return (
    <div className="stats-grid">
      <div className="stat-item">
        <span className="stat-label">Feed Loads Today</span>
        <span className="stat-number">
          {today.totalRequests.toLocaleString()}
          <Delta current={today.totalRequests} previous={yesterday?.totalRequests} />
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Unique Viewers</span>
        <span className="stat-number">
          {today.uniqueViewers.toLocaleString()}
          <Delta current={today.uniqueViewers} previous={yesterday?.uniqueViewers} />
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Scroll Depth</span>
        <span className="stat-number">{today.avgScrollDepth.toFixed(0)} posts</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Returning Viewers</span>
        <span className="stat-number">
          {today.returningViewers.toLocaleString()}
          <Delta current={today.returningViewers} previous={yesterday?.returningViewers} />
        </span>
      </div>
    </div>
  );
}

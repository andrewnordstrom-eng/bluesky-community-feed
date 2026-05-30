import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { AuditEntry } from '../../api/admin';
import { formatActionName, formatRelative, truncateDid } from '../../utils/format';
import { TableSkeleton } from '../Skeleton';
import { WeightImpactPanel } from './WeightImpactPanel';

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'vote_cast', label: 'Votes Cast' },
  { value: 'vote_updated', label: 'Votes Updated' },
  { value: 'epoch_transition', label: 'Epoch Transitions' },
  { value: 'epoch_transition_impact', label: 'Transition Impact' },
  { value: 'auto_epoch_transition', label: 'Auto Transitions' },
  { value: 'voting_opened', label: 'Voting Opened' },
  { value: 'voting_closed', label: 'Voting Closed' },
  { value: 'epoch_updated', label: 'Epoch Updated' },
  { value: 'admin_rules_override', label: 'Rules Overrides' },
  { value: 'admin_keyword_added', label: 'Keywords Added' },
  { value: 'admin_keyword_removed', label: 'Keywords Removed' },
  { value: 'admin_weights_override', label: 'Weight Overrides' },
  { value: 'admin_apply_results', label: 'Apply Results' },
  { value: 'admin_extend_voting', label: 'Extend Voting' },
  { value: 'admin_end_round', label: 'Round Transitions' },
  { value: 'announcement_posted', label: 'Announcements' },
  { value: 'manual_rescore', label: 'Manual Rescores' },
];

interface TransitionMover {
  uri: string;
  oldRank: number | null;
  newRank: number | null;
  change: number | null;
}

interface TransitionImpactDetails {
  oldEpochId: number | null;
  newEpochId: number | null;
  postsChangedRank: number;
  avgRankChange: number;
  topGainers: TransitionMover[];
  topLosers: TransitionMover[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toMoverList(value: unknown): TransitionMover[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const entry = item as Record<string, unknown>;
      if (typeof entry.uri !== 'string') {
        return null;
      }

      return {
        uri: entry.uri,
        oldRank: entry.oldRank === null ? null : toNumber(entry.oldRank),
        newRank: entry.newRank === null ? null : toNumber(entry.newRank),
        change: entry.change === null ? null : toNumber(entry.change),
      };
    })
    .filter((item): item is TransitionMover => item !== null);
}

function parseTransitionImpact(details: Record<string, unknown>): TransitionImpactDetails | null {
  const oldEpochId = details.oldEpochId ?? null;
  const newEpochId = details.newEpochId ?? null;

  if ((oldEpochId !== null && typeof oldEpochId !== 'number') || (newEpochId !== null && typeof newEpochId !== 'number')) {
    return null;
  }

  return {
    oldEpochId,
    newEpochId,
    postsChangedRank: toNumber(details.postsChangedRank),
    avgRankChange: toNumber(details.avgRankChange),
    topGainers: toMoverList(details.topGainers),
    topLosers: toMoverList(details.topLosers),
  };
}

function shortPost(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

function ImpactSummary({ details }: { details: Record<string, unknown> }) {
  const parsed = parseTransitionImpact(details);

  if (!parsed) {
    return (
      <code className="audit-details-code">{JSON.stringify(details)}</code>
    );
  }

  return (
    <div className="impact-summary-inline">
      <div>
        {parsed.postsChangedRank} posts changed rank
      </div>
      <div>
        Avg rank delta {parsed.avgRankChange.toFixed(2)}
      </div>
      <div>
        Epoch {parsed.oldEpochId ?? '?'} {'->'} {parsed.newEpochId ?? '?'}
      </div>
    </div>
  );
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ action: '', limit: 50 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchLog() {
      setIsLoading(true);
      try {
        const data = await adminApi.getAuditLog(filter);
        setEntries(data.entries || []);
        setTotal(data.total || 0);
      } catch (error) {
        console.error('Failed to fetch audit log', error);
        setEntries([]);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    }
    void fetchLog();
  }, [filter]);

  const transitionImpacts = useMemo(() => {
    return entries
      .filter((entry) => entry.action === 'epoch_transition_impact')
      .map((entry) => ({
        entry,
        details: parseTransitionImpact(entry.details),
      }))
      .filter((entry): entry is { entry: AuditEntry; details: TransitionImpactDetails } => entry.details !== null);
  }, [entries]);

  function handleLoadMore() {
    setFilter((previous) => ({ ...previous, limit: previous.limit + 50 }));
  }

  return (
    <div className="content-loaded">
      <WeightImpactPanel />

      <div className="admin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Audit Log</h2>
          <select
            value={filter.action}
            onChange={(event) => setFilter({ ...filter, action: event.target.value, limit: 50 })}
            style={{
              background: '#161718',
              border: '1px solid #2a2b2d',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#f1f3f5',
              fontSize: '14px',
            }}
          >
            {ACTION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : entries.length === 0 ? (
          <p className="empty-state">No audit entries found</p>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatRelative(entry.timestamp)}</td>
                    <td>
                      <span className={`status-badge ${getActionBadgeClass(entry.action)}`}>
                        {formatActionName(entry.action)}
                      </span>
                    </td>
                    <td>
                      {entry.actor === 'system' ? (
                        <span style={{ color: '#787c7e', fontStyle: 'italic' }}>System</span>
                      ) : (
                        <span title={entry.actor} style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                          {truncateDid(entry.actor)}
                        </span>
                      )}
                    </td>
                    <td>
                      {entry.action === 'epoch_transition_impact' ? (
                        <ImpactSummary details={entry.details} />
                      ) : (
                        <code className="audit-details-code">{JSON.stringify(entry.details)}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > filter.limit ? (
              <button className="btn-secondary" style={{ marginTop: '16px', width: '100%' }} onClick={handleLoadMore}>
                Load More ({total - filter.limit} remaining)
              </button>
            ) : null}
          </>
        )}
      </div>

      {transitionImpacts.length > 0 ? (
        <div className="admin-card">
          <h2>Transition Impact Diffs</h2>
          <div className="impact-diff-list">
            {transitionImpacts.map(({ entry, details }) => (
              <div key={entry.id} className="impact-diff-card">
                <div className="impact-diff-header">
                  <strong>
                    Epoch {details.oldEpochId ?? '?'} {'->'} {details.newEpochId ?? '?'}
                  </strong>
                  <span>{formatRelative(entry.timestamp)}</span>
                </div>

                <div className="stat-row">
                  <span>Posts changed rank</span>
                  <strong>{details.postsChangedRank}</strong>
                </div>
                <div className="stat-row">
                  <span>Average rank change</span>
                  <strong>{details.avgRankChange.toFixed(2)}</strong>
                </div>

                <div className="impact-movers-grid">
                  <div>
                    <h3>Top Gainers</h3>
                    {details.topGainers.length > 0 ? (
                      details.topGainers.map((mover) => (
                        <div key={`${entry.id}-${mover.uri}-gain`} className="stat-row">
                          <span>{shortPost(mover.uri)}</span>
                          <strong>{mover.change !== null ? mover.change : '-'}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="no-rules">No major gainers</p>
                    )}
                  </div>

                  <div>
                    <h3>Top Losers</h3>
                    {details.topLosers.length > 0 ? (
                      details.topLosers.map((mover) => (
                        <div key={`${entry.id}-${mover.uri}-loss`} className="stat-row">
                          <span>{shortPost(mover.uri)}</span>
                          <strong>{mover.change !== null ? `+${mover.change}` : '-'}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="no-rules">No major losers</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getActionBadgeClass(action: string): string {
  if (action.includes('transition')) return 'active';
  if (action.includes('vote')) return 'open';
  if (action.includes('failed') || action.includes('error')) return 'error';
  return 'closed';
}

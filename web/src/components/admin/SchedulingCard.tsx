import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type RoundSummary, type ScheduledVote } from '../../api/admin';

interface SchedulingCardProps {
  round: RoundSummary | null;
  onUpdate: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

function toInputDateTime(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(
    value.getMinutes()
  )}`;
}

function formatCountdown(votingEndsAt: string): string {
  const diff = new Date(votingEndsAt).getTime() - Date.now();
  if (diff <= 0) {
    return 'Voting end time has passed';
  }

  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `Voting ends in ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `Voting ends in ${hours}h ${minutes}m`;
  }

  return `Voting ends in ${minutes}m`;
}

function toPhase(round: RoundSummary | null): 'running' | 'voting' | 'results' {
  if (!round) {
    return 'running';
  }
  if (round.phase === 'voting' || round.phase === 'results' || round.phase === 'running') {
    return round.phase;
  }
  if (round.status === 'voting') {
    return 'voting';
  }
  return 'running';
}

export function SchedulingCard({ round, onUpdate, onNotify }: SchedulingCardProps) {
  const [scheduledVotes, setScheduledVotes] = useState<ScheduledVote[]>([]);
  const [startsAtInput, setStartsAtInput] = useState(() =>
    toInputDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [durationHours, setDurationHours] = useState(72);
  const [isSaving, setIsSaving] = useState(false);

  const phase = useMemo(() => toPhase(round), [round]);

  const loadSchedule = useCallback(async () => {
    try {
      const response = await adminApi.getVoteSchedule();
      setScheduledVotes(response.scheduledVotes);
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to load vote schedule');
    }
  }, [onNotify]);

  useEffect(() => {
    let isMounted = true;
    async function fetchScheduledVotes() {
      try {
        const response = await adminApi.getVoteSchedule();
        if (!isMounted) return;
        setScheduledVotes(response.scheduledVotes);
      } catch (error) {
        if (!isMounted) return;
        onNotify('error', error instanceof Error ? error.message : 'Failed to load vote schedule');
      }
    }
    void fetchScheduledVotes();
    return () => {
      isMounted = false;
    };
  }, [onNotify]);

  async function handleScheduleVote() {
    setIsSaving(true);
    try {
      const startsAtIso = new Date(startsAtInput).toISOString();
      await adminApi.scheduleVote(startsAtIso, durationHours);
      onNotify('success', 'Vote schedule saved');
      await loadSchedule();
      await onUpdate();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to schedule vote');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExtend24h() {
    setIsSaving(true);
    try {
      await adminApi.extendVoting(24);
      onNotify('success', 'Voting window extended by 24 hours');
      await onUpdate();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to extend voting');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-card">
      <h2>Schedule</h2>

      {phase === 'voting' && round?.votingEndsAt ? (
        <>
          <p className="countdown">{formatCountdown(round.votingEndsAt)}</p>
          <div className="action-buttons">
            <button type="button" className="btn-secondary" onClick={handleExtend24h} disabled={isSaving}>
              Extend 24h
            </button>
          </div>
          <div className="section-divider" />
        </>
      ) : null}

      <div className="form-group">
        <label htmlFor="schedule-start">Next vote starts at</label>
        <input
          id="schedule-start"
          type="datetime-local"
          value={startsAtInput}
          onChange={(event) => setStartsAtInput(event.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="schedule-duration">Duration (hours)</label>
        <input
          id="schedule-duration"
          type="number"
          min={1}
          max={168}
          value={durationHours}
          onChange={(event) => setDurationHours(Number(event.target.value))}
        />
      </div>

      <div className="action-buttons">
        <button type="button" className="btn-primary" onClick={handleScheduleVote} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Schedule Next Vote'}
        </button>
      </div>

      <div className="section-divider" />

      <h3>Upcoming Scheduled Votes</h3>
      {scheduledVotes.length === 0 ? (
        <p className="empty-state">No upcoming scheduled votes.</p>
      ) : (
        <div className="stats-list">
          {scheduledVotes.map((scheduledVote) => (
            <div key={scheduledVote.id} className="stat-row">
              <span>{new Date(scheduledVote.startsAt).toLocaleString()}</span>
              <strong>{scheduledVote.durationHours}h</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

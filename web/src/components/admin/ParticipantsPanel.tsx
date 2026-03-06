/**
 * Participants Panel
 *
 * Admin panel for managing approved participants in private feed mode.
 * Supports adding by DID or Bluesky handle, and soft-removing participants.
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { Participant } from '../../api/admin';
import { formatRelative } from '../../utils/format';
import { Skeleton } from '../Skeleton';

export function ParticipantsPanel() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [identifier, setIdentifier] = useState('');
  const [notes, setNotes] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [removingDid, setRemovingDid] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function fetchParticipants() {
    try {
      const data = await adminApi.getParticipants();
      setParticipants(data.participants);
    } catch (err) {
      console.error('Failed to fetch participants', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchParticipants();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;

    setIsAdding(true);
    setMessage(null);

    const input = identifier.trim();
    const isDid = input.startsWith('did:');

    try {
      const result = await adminApi.addParticipant({
        ...(isDid ? { did: input } : { handle: input }),
        notes: notes.trim() || undefined,
      });

      setMessage({
        type: 'success',
        text: `Added ${result.participant.handle || result.participant.did}`,
      });
      setIdentifier('');
      setNotes('');
      fetchParticipants();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add participant';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(did: string) {
    if (!confirm('Remove this participant from the approved list?')) return;

    setRemovingDid(did);
    setMessage(null);

    try {
      await adminApi.removeParticipant(did);
      setMessage({ type: 'success', text: 'Participant removed' });
      fetchParticipants();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove participant';
      setMessage({ type: 'error', text: msg });
    } finally {
      setRemovingDid(null);
    }
  }

  return (
    <div>
      {/* Add Participant */}
      <div className="admin-card">
        <h2>Add Participant</h2>
        <p className="text-secondary" style={{ marginBottom: '16px' }}>
          Add approved participants by DID or Bluesky handle. Handles are resolved to DIDs automatically.
        </p>

        {message && (
          <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleAdd}>
          <div className="form-group">
            <label htmlFor="participant-identifier">DID or Handle</label>
            <input
              id="participant-identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="did:plc:... or handle.bsky.social"
              disabled={isAdding}
            />
          </div>

          <div className="form-group">
            <label htmlFor="participant-notes">Notes (optional)</label>
            <input
              id="participant-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why they were added..."
              disabled={isAdding}
              maxLength={500}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isAdding || !identifier.trim()}
          >
            {isAdding ? 'Adding...' : 'Add Participant'}
          </button>
        </form>
      </div>

      {/* Participant List */}
      <div className="admin-card">
        <h2>Approved Participants ({participants.length})</h2>

        {isLoading ? (
          <div>
            <Skeleton variant="text" />
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        ) : participants.length === 0 ? (
          <p className="text-secondary">No participants added yet.</p>
        ) : (
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Handle / DID</th>
                  <th>Added By</th>
                  <th>Notes</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.did}>
                    <td>
                      {p.handle ? (
                        <div>
                          <span className="text-primary">@{p.handle}</span>
                          <br />
                          <span className="text-secondary" style={{ fontSize: '0.8em' }}>
                            {p.did}
                          </span>
                        </div>
                      ) : (
                        <span className="text-primary" style={{ fontSize: '0.9em' }}>
                          {p.did}
                        </span>
                      )}
                    </td>
                    <td className="text-secondary">{p.added_by}</td>
                    <td className="text-secondary">{p.notes || '—'}</td>
                    <td className="text-secondary">{formatRelative(p.added_at)}</td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleRemove(p.did)}
                        disabled={removingDid === p.did}
                      >
                        {removingDid === p.did ? '...' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

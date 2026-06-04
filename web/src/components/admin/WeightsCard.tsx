import { useEffect, useMemo, useState } from 'react';
import { adminApi, type GovernanceWeights } from '../../api/admin';

interface WeightsCardProps {
  weights: GovernanceWeights | null;
  onUpdate: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

interface WeightRowProps {
  label: string;
  value: number;
  onEdit: () => void;
}

const WEIGHT_FIELDS: Array<{ key: keyof GovernanceWeights; label: string }> = [
  { key: 'recency', label: 'Recency' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'bridging', label: 'Bridging' },
  { key: 'sourceDiversity', label: 'Source Diversity' },
  { key: 'relevance', label: 'Relevance' },
];

function normalizeDraft(weights: GovernanceWeights): GovernanceWeights {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Weights must contain at least one positive value');
  }

  return {
    recency: Math.max(0, weights.recency) / total,
    engagement: Math.max(0, weights.engagement) / total,
    bridging: Math.max(0, weights.bridging) / total,
    sourceDiversity: Math.max(0, weights.sourceDiversity) / total,
    relevance: Math.max(0, weights.relevance) / total,
  };
}

function WeightRow({ label, value, onEdit }: WeightRowProps) {
  return (
    <div className="weight-row">
      <span className="weight-label">{label}</span>
      <div className="weight-bar-container">
        <div className="weight-bar" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="weight-value">{Math.round(value * 100)}%</span>
      <button className="btn-icon" type="button" onClick={onEdit} title="Edit">
        Edit
      </button>
    </div>
  );
}

export function WeightsCard({ weights, onUpdate, onNotify }: WeightsCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<GovernanceWeights | null>(weights);
  const [displayWeights, setDisplayWeights] = useState<GovernanceWeights | null>(weights);
  const [prevWeights, setPrevWeights] = useState<GovernanceWeights | null>(weights);
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state with the latest weights prop (React-recommended pattern
  // for resetting state from props without an Effect).
  if (weights !== prevWeights) {
    setPrevWeights(weights);
    setDraft(weights);
    setDisplayWeights(weights);
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && isEditing && !isSaving) {
        setIsEditing(false);
        setDraft(displayWeights);
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isEditing, isSaving, displayWeights]);

  const normalizedPreview = useMemo(() => {
    if (!draft) {
      return null;
    }

    try {
      return normalizeDraft(draft);
    } catch {
      return null;
    }
  }, [draft]);

  if (!displayWeights) {
    return (
      <div className="admin-card">
        <h2>Algorithm Weights</h2>
        <p className="empty-state">No current weights available.</p>
      </div>
    );
  }

  async function handleSave() {
    if (!normalizedPreview) {
      onNotify('error', 'Weights are invalid and cannot be normalized');
      return;
    }

    setIsSaving(true);

    const previous = displayWeights;
    setDisplayWeights(normalizedPreview);

    try {
      await adminApi.updateWeights(normalizedPreview);
      onNotify('success', 'Weights updated and rescore triggered');
      setIsEditing(false);
      await onUpdate();
    } catch (error) {
      setDisplayWeights(previous);
      onNotify('error', error instanceof Error ? error.message : 'Failed to update weights');
    } finally {
      setIsSaving(false);
    }
  }

  function updateDraftValue(key: keyof GovernanceWeights, value: number) {
    if (!draft) {
      return;
    }

    const bounded = Math.min(1, Math.max(0, value));
    setDraft({
      ...draft,
      [key]: bounded,
    });
  }

  return (
    <div className="admin-card">
      <h2>Algorithm Weights</h2>

      {WEIGHT_FIELDS.map((field) => {
        const rowValue = isEditing && normalizedPreview ? normalizedPreview[field.key] : displayWeights[field.key];

        if (!isEditing || !draft) {
          return (
            <WeightRow
              key={field.key}
              label={field.label}
              value={rowValue}
              onEdit={() => setIsEditing(true)}
            />
          );
        }

        return (
          <div key={field.key} className="weight-row editing">
            <span className="weight-label">{field.label}</span>
            <input
              className="weight-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(draft[field.key] * 100)}
              onChange={(event) => updateDraftValue(field.key, Number(event.target.value) / 100)}
            />
            <input
              className="weight-input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(draft[field.key] * 100)}
              onChange={(event) => updateDraftValue(field.key, Number(event.target.value) / 100)}
            />
            <span className="weight-value">{Math.round(rowValue * 100)}%</span>
          </div>
        );
      })}

      {isEditing ? (
        <div className="action-buttons">
          <button type="button" className="btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setIsEditing(false);
              setDraft(displayWeights);
            }}
            disabled={isSaving}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <p className="help-text">
        <span className="help-text-icon">i</span>
        <span>This overrides voter results for the current round and triggers an immediate rescore.</span>
      </p>
    </div>
  );
}

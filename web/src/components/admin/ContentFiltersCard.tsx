import { useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import { ConfirmModal } from './ConfirmModal';

type KeywordType = 'include' | 'exclude';

interface ContentFiltersCardProps {
  includeKeywords: string[];
  excludeKeywords: string[];
  onUpdate: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

function validateKeyword(keyword: string): string | null {
  const trimmed = keyword.trim().toLowerCase();

  if (!trimmed) {
    return 'Keyword cannot be empty';
  }

  if (trimmed.length > 50) {
    return 'Keyword must be 50 characters or fewer';
  }

  if (!/^[a-z0-9][a-z0-9\s-]*$/i.test(trimmed)) {
    return 'Keyword can only contain letters, numbers, spaces, and hyphens';
  }

  return null;
}

function KeywordPill({ keyword, type, onRemove }: { keyword: string; type: KeywordType; onRemove: () => void }) {
  return (
    <span className={`pill pill-${type}`}>
      {keyword}
      <button className="pill-remove" onClick={onRemove} title="Remove" type="button">
        &times;
      </button>
    </span>
  );
}

export function ContentFiltersCard({
  includeKeywords,
  excludeKeywords,
  onUpdate,
  onNotify,
}: ContentFiltersCardProps) {
  const [localInclude, setLocalInclude] = useState(includeKeywords);
  const [localExclude, setLocalExclude] = useState(excludeKeywords);
  const [prevIncludeKeywords, setPrevIncludeKeywords] = useState(includeKeywords);
  const [prevExcludeKeywords, setPrevExcludeKeywords] = useState(excludeKeywords);
  const [activeForm, setActiveForm] = useState<KeywordType | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ type: KeywordType; keyword: string } | null>(null);

  // Sync local state with props when props change (React-recommended pattern for
  // resetting state from props without an Effect).
  if (includeKeywords !== prevIncludeKeywords) {
    setPrevIncludeKeywords(includeKeywords);
    setLocalInclude(includeKeywords);
  }
  if (excludeKeywords !== prevExcludeKeywords) {
    setPrevExcludeKeywords(excludeKeywords);
    setLocalExclude(excludeKeywords);
  }

  const includeSet = useMemo(() => new Set(localInclude), [localInclude]);
  const excludeSet = useMemo(() => new Set(localExclude), [localExclude]);

  async function handleAddKeyword(type: KeywordType) {
    const normalized = keywordInput.trim().toLowerCase();
    const validationError = validateKeyword(normalized);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    const targetSet = type === 'include' ? includeSet : excludeSet;
    if (targetSet.has(normalized)) {
      setFormError('Keyword already exists in this list');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const previousInclude = localInclude;
    const previousExclude = localExclude;

    if (type === 'include') {
      setLocalInclude([...localInclude, normalized]);
    } else {
      setLocalExclude([...localExclude, normalized]);
    }

    try {
      await adminApi.addKeyword(type, normalized);
      onNotify('success', `${type === 'include' ? 'Include' : 'Exclude'} keyword added`);
      setKeywordInput('');
      setActiveForm(null);
      await onUpdate();
    } catch (error) {
      setLocalInclude(previousInclude);
      setLocalExclude(previousExclude);
      onNotify('error', error instanceof Error ? error.message : 'Failed to add keyword');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemove) {
      return;
    }

    const { type, keyword } = pendingRemove;
    setIsSaving(true);

    const previousInclude = localInclude;
    const previousExclude = localExclude;

    if (type === 'include') {
      setLocalInclude(localInclude.filter((value) => value !== keyword));
    } else {
      setLocalExclude(localExclude.filter((value) => value !== keyword));
    }

    try {
      await adminApi.removeKeyword(type, keyword, type === 'include' && previousInclude.length === 1);
      onNotify('success', 'Keyword removed');
      setPendingRemove(null);
      await onUpdate();
    } catch (error) {
      setLocalInclude(previousInclude);
      setLocalExclude(previousExclude);
      onNotify('error', error instanceof Error ? error.message : 'Failed to remove keyword');
    } finally {
      setIsSaving(false);
    }
  }

  function cancelAdd() {
    setKeywordInput('');
    setFormError(null);
    setActiveForm(null);
  }

  return (
    <>
      <div className="admin-card">
        <h2>Content Filters</h2>

        <div className="keyword-section">
          <label>Include Keywords</label>
          <div className="keyword-pills">
            {localInclude.length > 0 ? (
              localInclude.map((keyword) => (
                <KeywordPill
                  key={`include-${keyword}`}
                  keyword={keyword}
                  type="include"
                  onRemove={() => setPendingRemove({ type: 'include', keyword })}
                />
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>

          {activeForm === 'include' ? (
            <div className="add-keyword-form">
              <input
                className="add-keyword-input"
                type="text"
                value={keywordInput}
                onChange={(event) => {
                  setKeywordInput(event.target.value);
                  setFormError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleAddKeyword('include');
                  }
                  if (event.key === 'Escape') {
                    cancelAdd();
                  }
                }}
                placeholder="keyword"
                maxLength={50}
                autoFocus
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleAddKeyword('include')}
                disabled={isSaving}
              >
                Add
              </button>
              <button type="button" className="btn-secondary" onClick={cancelAdd}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setActiveForm('include')}>
              + Add Include Keyword
            </button>
          )}
        </div>

        <div className="keyword-section">
          <label>Exclude Keywords</label>
          <div className="keyword-pills">
            {localExclude.length > 0 ? (
              localExclude.map((keyword) => (
                <KeywordPill
                  key={`exclude-${keyword}`}
                  keyword={keyword}
                  type="exclude"
                  onRemove={() => setPendingRemove({ type: 'exclude', keyword })}
                />
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>

          {activeForm === 'exclude' ? (
            <div className="add-keyword-form">
              <input
                className="add-keyword-input"
                type="text"
                value={keywordInput}
                onChange={(event) => {
                  setKeywordInput(event.target.value);
                  setFormError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleAddKeyword('exclude');
                  }
                  if (event.key === 'Escape') {
                    cancelAdd();
                  }
                }}
                placeholder="keyword"
                maxLength={50}
                autoFocus
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleAddKeyword('exclude')}
                disabled={isSaving}
              >
                Add
              </button>
              <button type="button" className="btn-secondary" onClick={cancelAdd}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setActiveForm('exclude')}>
              + Add Exclude Keyword
            </button>
          )}
        </div>

        {formError ? <div className="alert alert-error">{formError}</div> : null}

        <p className="help-text">
          <span className="help-text-icon">i</span>
          <span>
            Posts must match at least one include keyword (when set) and must not match any exclude keyword.
          </span>
        </p>
      </div>

      {pendingRemove ? (
        <ConfirmModal
          title="Remove Keyword?"
          message={
            pendingRemove.type === 'include' && localInclude.length === 1
              ? 'This is the last include keyword and will widen feed matching. Remove it?'
              : `Remove "${pendingRemove.keyword}" from ${pendingRemove.type} keywords?`
          }
          confirmText="Remove"
          confirmStyle="danger"
          isLoading={isSaving}
          onConfirm={() => void handleConfirmRemove()}
          onCancel={() => {
            if (!isSaving) {
              setPendingRemove(null);
            }
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Topics Panel
 *
 * Admin panel for managing the topic catalog.
 * Supports add, edit, deactivate/reactivate, and classification preview.
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { AdminTopic, ClassifyResult } from '../../api/admin';
import { Skeleton } from '../Skeleton';

interface TopicFormData {
  slug: string;
  name: string;
  description: string;
  terms: string;
  contextTerms: string;
  antiTerms: string;
}

const EMPTY_FORM: TopicFormData = {
  slug: '',
  name: '',
  description: '',
  terms: '',
  contextTerms: '',
  antiTerms: '',
};

export function TopicsPanel() {
  const [topics, setTopics] = useState<AdminTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [formData, setFormData] = useState<TopicFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  // Classification preview state
  const [classifyText, setClassifyText] = useState('');
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  async function fetchTopics() {
    try {
      const data = await adminApi.getTopics();
      setTopics(data);
    } catch (err) {
      console.error('Failed to fetch topics', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchTopics();
  }, []);

  function startEdit(topic: AdminTopic) {
    setEditingSlug(topic.slug);
    setShowAddForm(false);
    setFormData({
      slug: topic.slug,
      name: topic.name,
      description: topic.description || '',
      terms: topic.terms.join(', '),
      contextTerms: topic.contextTerms.join(', '),
      antiTerms: topic.antiTerms.join(', '),
    });
    setMessage(null);
  }

  function cancelEdit() {
    setEditingSlug(null);
    setShowAddForm(false);
    setFormData(EMPTY_FORM);
  }

  function parseTerms(input: string): string[] {
    return input.split(',').map(t => t.trim()).filter(Boolean);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.slug.trim() || !formData.name.trim() || !formData.terms.trim()) return;

    setIsSaving(true);
    setMessage(null);

    try {
      await adminApi.addTopic({
        slug: formData.slug.trim(),
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        terms: parseTerms(formData.terms),
        contextTerms: parseTerms(formData.contextTerms),
        antiTerms: parseTerms(formData.antiTerms),
      });

      setMessage({ type: 'success', text: `Topic created: ${formData.name}` });
      setFormData(EMPTY_FORM);
      setShowAddForm(false);
      fetchTopics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add topic';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSlug) return;

    setIsSaving(true);
    setMessage(null);

    try {
      await adminApi.updateTopic(editingSlug, {
        name: formData.name.trim() || undefined,
        terms: parseTerms(formData.terms),
        contextTerms: parseTerms(formData.contextTerms),
        antiTerms: parseTerms(formData.antiTerms),
      });

      setMessage({ type: 'success', text: `Topic updated: ${editingSlug}` });
      setEditingSlug(null);
      setFormData(EMPTY_FORM);
      fetchTopics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update topic';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeactivate(slug: string) {
    if (!confirm(`Deactivate topic "${slug}"? It will no longer affect scoring.`)) return;

    setMessage(null);
    try {
      await adminApi.deactivateTopic(slug);
      setMessage({ type: 'success', text: `Topic deactivated: ${slug}` });
      fetchTopics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to deactivate topic';
      setMessage({ type: 'error', text: msg });
    }
  }

  async function handleClassify() {
    if (!classifyText.trim()) return;

    setIsClassifying(true);
    setClassifyResult(null);

    try {
      const result = await adminApi.classifyText(classifyText.trim());
      setClassifyResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Classification failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsClassifying(false);
    }
  }

  const activeTopics = topics.filter(t => t.isActive);
  const totalPosts = activeTopics.reduce((sum, t) => sum + t.postCount, 0);

  function renderForm(isEdit: boolean) {
    return (
      <form onSubmit={isEdit ? handleUpdate : handleAdd}>
        {!isEdit && (
          <div className="form-group">
            <label htmlFor="topic-slug">Slug</label>
            <input
              id="topic-slug"
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              placeholder="lowercase-with-hyphens"
              pattern="^[a-z0-9-]+$"
              disabled={isSaving}
              required
            />
          </div>
        )}

        <div className="form-group">
          <label htmlFor="topic-name">Name</label>
          <input
            id="topic-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Display name"
            disabled={isSaving}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="topic-description">Description</label>
          <textarea
            id="topic-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
            disabled={isSaving}
            rows={2}
          />
        </div>

        <div className="form-group">
          <label htmlFor="topic-terms">Primary Terms (comma-separated)</label>
          <textarea
            id="topic-terms"
            value={formData.terms}
            onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
            placeholder="corgi, pembroke, cardigan"
            disabled={isSaving}
            rows={2}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="topic-context-terms">Context Terms (comma-separated)</label>
          <textarea
            id="topic-context-terms"
            value={formData.contextTerms}
            onChange={(e) => setFormData({ ...formData, contextTerms: e.target.value })}
            placeholder="dog, breed, puppy"
            disabled={isSaving}
            rows={2}
          />
        </div>

        <div className="form-group">
          <label htmlFor="topic-anti-terms">Anti Terms (comma-separated)</label>
          <textarea
            id="topic-anti-terms"
            value={formData.antiTerms}
            onChange={(e) => setFormData({ ...formData, antiTerms: e.target.value })}
            placeholder="Terms that exclude this topic"
            disabled={isSaving}
            rows={2}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : isEdit ? 'Update Topic' : 'Add Topic'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={cancelEdit}
            disabled={isSaving}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
          {message.text}
        </div>
      )}

      {/* Add Topic */}
      <div className="admin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2>Topic Catalog ({activeTopics.length} active, {totalPosts} posts)</h2>
          {!showAddForm && !editingSlug && (
            <button
              className="btn btn-primary"
              onClick={() => { setShowAddForm(true); setFormData(EMPTY_FORM); setMessage(null); }}
            >
              Add Topic
            </button>
          )}
        </div>

        {showAddForm && renderForm(false)}
      </div>

      {/* Edit Form (shown separately when editing) */}
      {editingSlug && (
        <div className="admin-card">
          <h2>Edit: {editingSlug}</h2>
          {renderForm(true)}
        </div>
      )}

      {/* Topic List */}
      <div className="admin-card">
        {isLoading ? (
          <div>
            <Skeleton variant="text" />
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        ) : topics.length === 0 ? (
          <p className="text-secondary">No topics in catalog.</p>
        ) : (
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Topic</th>
                  <th>Posts</th>
                  <th>Weight</th>
                  <th>Terms</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.slug} style={!t.isActive ? { opacity: 0.6 } : undefined}>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: t.isActive ? 'var(--color-success, #22c55e)' : 'var(--color-text-tertiary, #666)',
                      }} title={t.isActive ? 'Active' : 'Inactive'} />
                    </td>
                    <td>
                      <span className="text-primary">{t.name}</span>
                      <br />
                      <span className="text-secondary" style={{ fontSize: '0.8em' }}>{t.slug}</span>
                    </td>
                    <td>{t.postCount}</td>
                    <td>{t.currentWeight !== null ? t.currentWeight.toFixed(2) : '—'}</td>
                    <td>
                      <span className="text-secondary" style={{ fontSize: '0.85em' }}>
                        {t.terms.slice(0, 5).join(', ')}{t.terms.length > 5 ? `, +${t.terms.length - 5}` : ''}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => startEdit(t)}
                          disabled={editingSlug === t.slug}
                        >
                          Edit
                        </button>
                        {t.isActive ? (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeactivate(t.slug)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={async () => {
                              try {
                                await adminApi.updateTopic(t.slug, { name: t.name });
                                setMessage({ type: 'success', text: `Topic reactivated: ${t.slug}` });
                                fetchTopics();
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : 'Failed';
                                setMessage({ type: 'error', text: msg });
                              }
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Classification Preview */}
      <div className="admin-card">
        <h2>Test Classification</h2>
        <p className="text-secondary" style={{ marginBottom: '16px' }}>
          Enter text to see how it would be classified against the topic taxonomy.
        </p>

        <div className="form-group">
          <textarea
            value={classifyText}
            onChange={(e) => setClassifyText(e.target.value)}
            placeholder="Enter sample post text..."
            rows={3}
            disabled={isClassifying}
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleClassify}
          disabled={isClassifying || !classifyText.trim()}
          style={{ marginBottom: '16px' }}
        >
          {isClassifying ? 'Classifying...' : 'Classify'}
        </button>

        {classifyResult && (
          <div>
            <p><strong>Tokens:</strong> {classifyResult.tokenCount}</p>
            {classifyResult.matchedTopics.length === 0 ? (
              <p className="text-secondary">No topics matched.</p>
            ) : (
              <div>
                <p><strong>Matched {classifyResult.matchedTopics.length} topics:</strong></p>
                <div className="table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(classifyResult.vector)
                        .sort((a, b) => b[1] - a[1])
                        .map(([slug, score]) => (
                          <tr key={slug}>
                            <td>{slug}</td>
                            <td>{score.toFixed(2)}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

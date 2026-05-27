import { useCallback, useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { Announcement } from '../../api/admin';
import { formatRelative } from '../../utils/format';
import { Skeleton } from '../Skeleton';
import { openAnnouncementPost } from './announcement-link';

export function AnnouncementPanel() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [content, setContent] = useState('');
  const [includeLink, setIncludeLink] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const data = await adminApi.getAnnouncements();
      setAnnouncements(data.announcements);
    } catch (err) {
      console.error('Failed to fetch announcements', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadAnnouncements() {
      try {
        const data = await adminApi.getAnnouncements();
        setAnnouncements(data.announcements);
      } catch (err) {
        console.error('Failed to fetch announcements', err);
      } finally {
        setIsLoading(false);
      }
    }
    void loadAnnouncements();
  }, []);

  async function handlePost() {
    if (!content.trim() || content.length > 280) return;

    setIsPosting(true);
    setMessage(null);

    try {
      const result = await adminApi.postAnnouncement({
        content: content.trim(),
        includeEpochLink: includeLink
      });

      setMessage({ type: 'success', text: 'Announcement posted!' });
      setContent('');
      fetchAnnouncements();

      // Open in new tab
      openAnnouncementPost(result.announcement.postUrl);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to post' });
    } finally {
      setIsPosting(false);
    }
  }

  const charCount = content.length;
  const isOverLimit = charCount > 280;

  return (
    <div>
      {/* New Announcement */}
      <div className="admin-card">
        <h2>Post Announcement</h2>

        {message && (
          <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
            {message.text}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="announcement-content">Message</label>
          <textarea
            id="announcement-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your announcement..."
            rows={4}
          />
          <div className={`char-count ${isOverLimit ? 'over-limit' : ''}`}>
            {charCount}/280
          </div>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => setIncludeLink(e.target.checked)}
            />
            Include link to voting page
          </label>
        </div>

        <button
          className="btn-primary"
          onClick={handlePost}
          disabled={isPosting || isOverLimit || !content.trim()}
        >
          {isPosting ? 'Posting...' : 'Post to Bluesky'}
        </button>
      </div>

      {/* Recent Announcements */}
      <div className="admin-card">
        <h2>Recent Announcements</h2>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="card" height="100px" />
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <p className="empty-state">No announcements yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {announcements.map(a => (
              <div
                key={a.id}
                style={{
                  background: '#161718',
                  borderRadius: '8px',
                  padding: '16px'
                }}
              >
                <p style={{ color: '#f1f3f5', margin: '0 0 12px 0', whiteSpace: 'pre-wrap' }}>
                  {a.content}
                </p>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '13px',
                  color: '#787c7e'
                }}>
                  <span>{formatRelative(a.postedAt)}</span>
                  <a
                    href={a.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1083fe', textDecoration: 'none' }}
                  >
                    View on Bluesky
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

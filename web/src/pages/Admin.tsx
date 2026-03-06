/**
 * Admin Dashboard Page
 *
 * Main admin interface with tabbed navigation for:
 * - Overview: System status summary
 * - Governance: Round management and direct overrides
 * - Announcements: Bot announcements
 * - Feed Health: System health monitoring
 * - Audit Log: Activity logging
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminGuard } from '../components/admin/AdminGuard';
import { OverviewPanel } from '../components/admin/OverviewPanel';
import { GovernancePanel } from '../components/admin/GovernancePanel';
import { AnnouncementPanel } from '../components/admin/AnnouncementPanel';
import { FeedHealth } from '../components/admin/FeedHealth';
import { AuditLog } from '../components/admin/AuditLog';
import { InteractionsPanel } from '../components/admin/InteractionsPanel';
import { ParticipantsPanel } from '../components/admin/ParticipantsPanel';
import { TabPanel } from '../components/TabPanel';
import { useAuth } from '../contexts/useAuth';
import { useAdminStatus } from '../hooks/useAdminStatus';
import '../styles/admin.css';

type AdminTab = 'overview' | 'governance' | 'announcements' | 'health' | 'interactions' | 'participants' | 'audit';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const { userHandle, logout } = useAuth();
  const { status } = useAdminStatus();
  const isPrivateMode = status?.feedPrivateMode ?? false;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <AdminGuard>
      <div className="admin-page">
        <header className="admin-page-header">
          <div className="header-content">
            <div className="header-left">
              <h1>Community feed</h1>
              <nav className="header-nav">
                <Link to="/vote" className="nav-link">Vote</Link>
                <Link to="/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/history" className="nav-link">History</Link>
                <Link to="/admin" className="nav-link active">Admin</Link>
              </nav>
            </div>
            <div className="user-info">
              <span className="user-handle">@{userHandle}</span>
              <button onClick={handleLogout} className="logout-button">
                Log out
              </button>
            </div>
          </div>
        </header>

        <div className="admin-container">
          <header className="admin-header">
            <h1>Admin Dashboard</h1>
            <p className="admin-subtitle">Manage feed governance and monitor system health</p>
          </header>

          <nav className="admin-tabs">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'governance', label: 'Governance' },
              { id: 'announcements', label: 'Announcements' },
              { id: 'health', label: 'Feed Health' },
              { id: 'interactions', label: 'Interactions' },
              ...(isPrivateMode ? [{ id: 'participants', label: 'Participants' }] : []),
              { id: 'audit', label: 'Audit Log' }
            ].map(tab => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id as AdminTab)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <main className="admin-content page-content">
            <div className="tab-panel-wrapper">
              <TabPanel isActive={activeTab === 'overview'} tabKey="overview">
                <OverviewPanel onNavigate={(tab) => setActiveTab(tab as AdminTab)} />
              </TabPanel>
              <TabPanel isActive={activeTab === 'governance'} tabKey="governance">
                <GovernancePanel />
              </TabPanel>
              <TabPanel isActive={activeTab === 'announcements'} tabKey="announcements">
                <AnnouncementPanel />
              </TabPanel>
              <TabPanel isActive={activeTab === 'health'} tabKey="health">
                <FeedHealth />
              </TabPanel>
              <TabPanel isActive={activeTab === 'interactions'} tabKey="interactions">
                <InteractionsPanel />
              </TabPanel>
              {isPrivateMode && (
                <TabPanel isActive={activeTab === 'participants'} tabKey="participants">
                  <ParticipantsPanel />
                </TabPanel>
              )}
              <TabPanel isActive={activeTab === 'audit'} tabKey="audit">
                <AuditLog />
              </TabPanel>
            </div>
          </main>
        </div>
      </div>
    </AdminGuard>
  );
}

export default AdminPage;

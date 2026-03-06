/**
 * Admin Routes Index
 *
 * Registers all admin API routes under /api/admin prefix.
 * All routes require admin authentication via requireAdmin preHandler.
 */

import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../auth/admin.js';
import { registerStatusRoutes } from './status.js';
import { registerEpochRoutes } from './epochs.js';
import { registerAnnouncementRoutes } from './announcements.js';
import { registerFeedHealthRoutes } from './feed-health.js';
import { registerAdminHealthRoutes } from './health.js';
import { registerAuditLogRoutes } from './audit-log.js';
import { registerAuditAnalysisRoutes } from './audit-analysis.js';
import { registerSchedulerRoutes } from './scheduler.js';
import { registerGovernanceRoutes } from './governance.js';
import { registerInteractionRoutes } from './interactions.js';
import { registerParticipantRoutes } from './participants.js';
import { registerExportRoutes } from './export.js';
import { logger } from '../../lib/logger.js';

export function registerAdminRoutes(app: FastifyInstance): void {
  app.register(
    async (adminApp) => {
      // All admin routes require admin authentication
      adminApp.addHook('preHandler', requireAdmin);

      // Register route modules
      registerStatusRoutes(adminApp);
      registerEpochRoutes(adminApp);
      registerAnnouncementRoutes(adminApp);
      registerFeedHealthRoutes(adminApp);
      registerAdminHealthRoutes(adminApp);
      registerAuditLogRoutes(adminApp);
      registerAuditAnalysisRoutes(adminApp);
      registerSchedulerRoutes(adminApp);
      registerGovernanceRoutes(adminApp);
      registerInteractionRoutes(adminApp);
      registerParticipantRoutes(adminApp);
      registerExportRoutes(adminApp);

      logger.info('Admin routes registered');
    },
    { prefix: '/api/admin' }
  );
}

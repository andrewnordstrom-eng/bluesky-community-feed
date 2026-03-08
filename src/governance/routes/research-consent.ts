/**
 * Research Consent Route
 *
 * GET /api/governance/research-consent - Get consent status for authenticated user
 * POST /api/governance/research-consent - Record consent decision
 *
 * Research consent is separate from TOS acceptance. Users who decline
 * retain full access to all governance features.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { ErrorResponseSchema, governanceSecurity } from '../../lib/openapi.js';
import { getAuthenticatedDid } from '../auth.js';
import { logger } from '../../lib/logger.js';

const CONSENT_VERSION = '2026-02-19-v1';

const consentBodySchema = z.object({
  consent: z.boolean(),
});

/** JSON Schema for OpenAPI documentation. */
const consentBodyJsonSchema = zodToJsonSchema(consentBodySchema, { target: 'jsonSchema7' });

export function registerResearchConsentRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/research-consent
   * Returns the current research consent status for the authenticated user.
   */
  app.get('/api/governance/research-consent', {
    schema: {
      tags: ['Governance'],
      summary: 'Get research consent status',
      description: 'Returns the authenticated user\'s current research consent status. Research consent is separate from TOS — declining does not restrict governance access.',
      security: governanceSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            consent: { type: 'boolean', nullable: true, description: 'Current consent status' },
            consentedAt: { type: 'string', format: 'date-time', nullable: true },
            consentVersion: { type: 'string', nullable: true },
          },
        },
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const did = await getAuthenticatedDid(request);
    if (!did) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    const result = await db.query(
      `SELECT research_consent, research_consent_at, research_consent_version
       FROM subscribers WHERE did = $1`,
      [did]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'Subscriber not found.',
      });
    }

    const row = result.rows[0];
    return reply.send({
      consent: row.research_consent,
      consentedAt: row.research_consent_at,
      consentVersion: row.research_consent_version,
    });
  });

  /**
   * POST /api/governance/research-consent
   * Record the user's research consent decision.
   */
  app.post('/api/governance/research-consent', {
    schema: {
      tags: ['Governance'],
      summary: 'Record research consent',
      description: 'Record or update the user\'s research consent decision. Consent changes are logged to the audit trail.',
      security: governanceSecurity,
      body: consentBodyJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
          required: ['success'],
        },
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const did = await getAuthenticatedDid(request);
    if (!did) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    const parsed = consentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Request body must include { consent: boolean }.',
      });
    }

    const { consent } = parsed.data;

    // Check previous consent state to determine audit action
    const previous = await db.query(
      `SELECT research_consent FROM subscribers WHERE did = $1`,
      [did]
    );
    const previousConsent = previous.rows[0]?.research_consent;

    await db.query(
      `UPDATE subscribers
       SET research_consent = $1,
           research_consent_at = NOW(),
           research_consent_version = $2
       WHERE did = $3`,
      [consent, CONSENT_VERSION, did]
    );

    // Determine audit action: initial recording vs withdrawal vs re-consent
    let auditAction = 'research_consent_recorded';
    if (previousConsent === true && consent === false) {
      auditAction = 'research_consent_withdrawn';
    } else if (previousConsent === false && consent === true) {
      auditAction = 'research_consent_restored';
    }

    // Log to audit trail
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
       VALUES ($1, $2, NULL, $3)`,
      [
        auditAction,
        did,
        JSON.stringify({
          consent,
          previousConsent: previousConsent ?? null,
          version: CONSENT_VERSION,
        }),
      ]
    );

    logger.info({ did, consent, auditAction }, 'Research consent recorded');

    return reply.send({ success: true });
  });
}

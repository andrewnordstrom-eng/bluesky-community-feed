/**
 * Polis Route (Placeholder)
 *
 * Placeholder for future Polis integration.
 * Polis provides deliberation infrastructure for gathering nuanced community input
 * that can inform governance weight voting.
 *
 * @status placeholder — returns static config; no live Polis API calls
 * @planned Full integration: embed conversations, sync opinion groups,
 *   detect consensus areas, and feed results into governance weight suggestions.
 *
 * Endpoints:
 * - GET /api/governance/polis — conversation info (if POLIS_CONVERSATION_ID set)
 * - GET /api/governance/polis/status — feature roadmap for the integration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config.js';

export function registerPolisRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/polis
   * Returns Polis conversation info if configured.
   * Currently a placeholder for future integration.
   */
  app.get('/api/governance/polis', {
    schema: {
      tags: ['Governance'],
      summary: 'Polis conversation info',
      description: 'Returns Polis conversation info if configured. Currently a placeholder for future deliberation integration.',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            conversationId: { type: 'string' },
            embedUrl: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' },
            documentation: { type: 'string' },
          },
          required: ['enabled'],
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const polisConversationId = config.POLIS_CONVERSATION_ID;

    if (!polisConversationId) {
      return reply.send({
        enabled: false,
        message: 'Polis integration is not configured. Set POLIS_CONVERSATION_ID to enable.',
        documentation: 'https://pol.is/docs',
      });
    }

    return reply.send({
      enabled: true,
      conversationId: polisConversationId,
      embedUrl: `https://pol.is/${polisConversationId}`,
      description: 'Polis deliberation for feed governance. Participate in discussions about how the feed algorithm should work.',
      status: 'placeholder',
      message: 'Full Polis integration coming in a future release.',
    });
  });

  /**
   * GET /api/governance/polis/status
   * Check Polis integration status.
   */
  app.get('/api/governance/polis/status', {
    schema: {
      tags: ['Governance'],
      summary: 'Polis integration status',
      description: 'Returns the current status of the Polis integration roadmap and planned features.',
      response: {
        200: {
          type: 'object',
          properties: {
            integration: { type: 'string', description: 'Overall integration status' },
            features: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  status: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
          required: ['integration', 'features'],
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      integration: 'planned',
      features: [
        {
          name: 'deliberation_embedding',
          status: 'not_implemented',
          description: 'Embed Polis conversations in the governance UI',
        },
        {
          name: 'opinion_groups',
          status: 'not_implemented',
          description: 'Show opinion group clustering from Polis',
        },
        {
          name: 'consensus_detection',
          status: 'not_implemented',
          description: 'Identify areas of consensus for weight recommendations',
        },
        {
          name: 'vote_influence',
          status: 'not_implemented',
          description: 'Use Polis results to inform governance voting',
        },
      ],
    });
  });
}

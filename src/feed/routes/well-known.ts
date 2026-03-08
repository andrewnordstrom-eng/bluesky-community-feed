import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';

/**
 * Register the well-known DID document endpoint.
 * This is used for did:web resolution (fallback, not recommended for production).
 * For production, use did:plc instead.
 *
 * Spec: §9.5 - GET /.well-known/did.json
 */
export function registerWellKnown(app: FastifyInstance): void {
  app.get('/.well-known/did.json', {
    schema: {
      tags: ['Feed'],
      summary: 'DID document',
      description: 'Returns the DID document for did:web resolution. Used as a fallback — production uses did:plc.',
      response: {
        200: {
          type: 'object',
          properties: {
            '@context': { type: 'array', items: { type: 'string' } },
            id: { type: 'string', description: 'DID identifier', example: 'did:web:feed.corgi.network' },
            service: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: '#bsky_fg' },
                  type: { type: 'string', example: 'BskyFeedGenerator' },
                  serviceEndpoint: { type: 'string', example: 'https://feed.corgi.network' },
                },
                required: ['id', 'type', 'serviceEndpoint'],
              },
            },
          },
          required: ['@context', 'id', 'service'],
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: `did:web:${config.FEEDGEN_HOSTNAME}`,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${config.FEEDGEN_HOSTNAME}`,
        },
      ],
    });
  });
}

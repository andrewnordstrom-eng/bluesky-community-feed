import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { getFeedCommunities, publicFeedUris, type FeedCommunity } from '../community-registry.js';

export interface RegisterDescribeGeneratorOptions {
  communities: readonly FeedCommunity[];
}

/**
 * Register the describeFeedGenerator endpoint.
 * This is called by Bluesky to discover what feeds this generator provides.
 *
 * Spec: §9.4 - GET /xrpc/app.bsky.feed.describeFeedGenerator
 */
export function registerDescribeGenerator(app: FastifyInstance, options?: RegisterDescribeGeneratorOptions): void {
  const communities = options?.communities ?? getFeedCommunities();

  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', {
    schema: {
      tags: ['Feed'],
      summary: 'Describe feed generator',
      description: 'Returns the DID and feed URIs for this generator. Called by Bluesky for feed discovery.',
      response: {
        200: {
          type: 'object',
          properties: {
            did: { type: 'string', description: 'Service DID for this feed generator', example: 'did:web:feed.corgi.network' },
            feeds: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string', description: 'AT-URI of the feed', example: 'at://did:plc:example/app.bsky.feed.generator/community-gov' },
                },
                required: ['uri'],
              },
              description: 'List of feeds served by this generator',
            },
          },
          required: ['did', 'feeds'],
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      did: config.FEEDGEN_SERVICE_DID,
      feeds: publicFeedUris(communities, config.FEEDGEN_PUBLISHER_DID).map((uri) => ({ uri })),
    });
  });
}

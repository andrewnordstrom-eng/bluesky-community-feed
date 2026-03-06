import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  // Identity
  FEEDGEN_SERVICE_DID: z.string().startsWith('did:'),
  FEEDGEN_PUBLISHER_DID: z.string().startsWith('did:'),
  FEEDGEN_HOSTNAME: z.string().min(1),

  // Server
  FEEDGEN_PORT: z.coerce.number().default(3000),
  FEEDGEN_LISTENHOST: z.string().default('0.0.0.0'),

  // Jetstream
  JETSTREAM_URL: z.string().url(),
  JETSTREAM_FALLBACK_URL: z.string().url(),
  JETSTREAM_COLLECTIONS: z.string(),

  // Database
  DATABASE_URL: z.string().startsWith('postgresql://'),

  // Redis
  REDIS_URL: z.string().startsWith('redis://'),

  // Feed requester JWT verification
  FEED_JWT_AUDIENCE: z.string().default(''),
  FEED_JWT_ALLOWED_ISSUER_PREFIXES: z.string().default('did:plc:'),
  FEED_JWT_MAX_FUTURE_SKEW_SECONDS: z.coerce.number().default(300),

  // Scoring
  SCORING_INTERVAL_CRON: z.string().default('*/5 * * * *'),
  SCORING_INTERVAL_MS: z.coerce.number().default(300_000), // 5 minutes in milliseconds
  SCORING_WINDOW_HOURS: z.coerce.number().default(72),
  FEED_MAX_POSTS: z.coerce.number().default(1000),

  // Governance
  GOVERNANCE_MIN_VOTES: z.coerce.number().default(5),
  GOVERNANCE_PERIOD_HOURS: z.coerce.number().default(168),

  // Bluesky API
  BSKY_IDENTIFIER: z.string(),
  BSKY_APP_PASSWORD: z.string(),

  // Optional
  POLIS_CONVERSATION_ID: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('loopback'),
  GOVERNANCE_SESSION_COOKIE_NAME: z.string().default('governance_session'),
  GOVERNANCE_SESSION_COOKIE_SAME_SITE: z
    .enum(['strict', 'lax', 'none'])
    .default('lax'),

  // API rate limiting
  RATE_LIMIT_ENABLED: z.coerce.boolean().default(true),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(200),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_VOTE_MAX: z.coerce.number().default(20),
  RATE_LIMIT_VOTE_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().default(30),
  RATE_LIMIT_ADMIN_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_ADMIN_CRITICAL_MAX: z.coerce.number().default(10),
  RATE_LIMIT_ADMIN_CRITICAL_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_INTERACTIONS_MAX: z.coerce.number().default(60),
  RATE_LIMIT_INTERACTIONS_WINDOW_MS: z.coerce.number().default(60_000),

  // Private feed mode (research gating)
  FEED_PRIVATE_MODE: z.coerce.boolean().default(false),

  // Bot (optional)
  BOT_ENABLED: z.coerce.boolean().default(false),
  BOT_HANDLE: z.string().optional(),
  BOT_APP_PASSWORD: z.string().optional(),
  BOT_ADMIN_DIDS: z.string().optional().default(''),
  BOT_PIN_TTL_HOURS: z.coerce.number().default(24),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config = ConfigSchema.parse(process.env);

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const INSECURE_EXPORT_SALT_DEFAULT = 'dev-salt-not-for-prod';

/**
 * Zod schema for boolean env vars that correctly handles the string "false".
 *
 * `z.coerce.boolean()` uses JavaScript's `Boolean()` constructor, which treats
 * ANY non-empty string as `true` — including `"false"`. This helper treats
 * `"true"` and `"1"` as true, everything else (including `"false"`, `"0"`, `""`) as false.
 */
function zodEnvBool(defaultValue: boolean) {
  return z.preprocess(
    (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
      return defaultValue;
    },
    z.boolean().default(defaultValue),
  );
}

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
  SCORING_FULL_RESCORE_INTERVAL: z.coerce.number().int().min(1).default(6),
  SCORING_CANDIDATE_LIMIT: z.coerce.number().min(100).default(5_000),
  SCORING_TIMEOUT_MS: z.coerce.number().min(30_000).default(240_000),
  FEED_MAX_POSTS: z.coerce.number().default(1000),

  // Topic embedding classifier
  /** Enable semantic embedding classifier at ingestion time. */
  TOPIC_EMBEDDING_ENABLED: zodEnvBool(false),
  /** Minimum cosine similarity threshold for topic assignment (0.0-1.0). */
  TOPIC_EMBEDDING_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.35),

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
  RATE_LIMIT_ENABLED: zodEnvBool(true),
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

  // Content filtering
  FILTER_NSFW_LABELS: zodEnvBool(true),

  // Ingestion gate: reject posts below community relevance threshold
  INGESTION_GATE_ENABLED: zodEnvBool(true),
  INGESTION_MIN_RELEVANCE: z.coerce.number().min(0).max(1).default(0.10),
  INGESTION_MIN_TEXT_FOR_MEDIA: z.coerce.number().min(0).default(10),

  // Jetstream throughput tuning
  /** Max concurrent DB operations for event processing. Keep below DB_POOL_MAX to leave headroom for HTTP handlers. */
  JETSTREAM_MAX_CONCURRENT: z.coerce.number().min(1).default(20),
  /** Max pending events in backpressure queue before triggering reconnect. */
  JETSTREAM_MAX_PENDING: z.coerce.number().min(100).default(10_000),

  // Database pool tuning
  /** Max connections in the PostgreSQL connection pool. */
  DB_POOL_MAX: z.coerce.number().min(5).default(50),
  /** Statement timeout in milliseconds (prevents runaway queries). */
  DB_STATEMENT_TIMEOUT: z.coerce.number().min(1000).default(30_000),

  // Feed output: minimum relevance score to appear in feed
  FEED_MIN_RELEVANCE: z.coerce.number().min(0).max(1).default(0.15),

  // Private feed mode (research gating)
  FEED_PRIVATE_MODE: zodEnvBool(false),

  // URL deduplication: penalize reshares of the same external link
  /** Enable URL-based reshare deduplication in feed output. */
  FEED_DEDUP_ENABLED: zodEnvBool(true),
  /** Minimum original text length (chars) to skip dedup penalty. Posts with this much text are treated as original commentary. */
  FEED_DEDUP_MIN_TEXT: z.coerce.number().min(0).default(200),

  // Bot (optional)
  BOT_ENABLED: zodEnvBool(false),
  BOT_HANDLE: z.string().optional(),
  BOT_APP_PASSWORD: z.string().optional(),
  BOT_ADMIN_DIDS: z.string().optional().default(''),
  BOT_PIN_TTL_HOURS: z.coerce.number().default(24),

  // Disk monitoring thresholds (percentage)
  DISK_WARNING_PERCENT: z.coerce.number().min(50).max(100).default(80),
  DISK_CRITICAL_PERCENT: z.coerce.number().min(50).max(100).default(90),
  DISK_EMERGENCY_PERCENT: z.coerce.number().min(50).max(100).default(95),

  // Research export
  EXPORT_ANONYMIZATION_SALT: z.string().min(16).default(INSECURE_EXPORT_SALT_DEFAULT),
}).superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV !== 'production') {
    return;
  }

  if (cfg.EXPORT_ANONYMIZATION_SALT === INSECURE_EXPORT_SALT_DEFAULT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EXPORT_ANONYMIZATION_SALT'],
      message: 'EXPORT_ANONYMIZATION_SALT must be explicitly set in production.',
    });
  }

  if (cfg.EXPORT_ANONYMIZATION_SALT.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EXPORT_ANONYMIZATION_SALT'],
      message: 'EXPORT_ANONYMIZATION_SALT should be at least 32 characters in production.',
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

export const config = ConfigSchema.parse(process.env);

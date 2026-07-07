import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  commandTimeout: config.REDIS_COMMAND_TIMEOUT_MS,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.debug('Connected to Redis');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

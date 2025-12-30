import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let redisConnection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (redisConnection) {
    return redisConnection;
  }

  const redisConfig: any = {
    host: env.REDIS_HOST,
    port: parseInt(env.REDIS_PORT),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false, // Required for BullMQ
  };

  if (env.REDIS_PASSWORD) {
    redisConfig.password = env.REDIS_PASSWORD;
  }

  // Enable TLS unless explicitly disabled
  if (!env.REDIS_TLS_DISABLED) {
    redisConfig.tls = {};
  }

  redisConnection = new Redis(redisConfig);

  redisConnection.on('error', (err) => {
    logger.error('Redis connection error', err);
  });

  redisConnection.on('connect', () => {
    logger.info('Connected to Redis');
  });

  return redisConnection;
}

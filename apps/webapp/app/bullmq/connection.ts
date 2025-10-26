import Redis, { type RedisOptions } from "ioredis";

let redisConnection: Redis | null = null;

/**
 * Get or create a Redis connection for BullMQ
 * This connection is shared across all queues and workers
 */
export function getRedisConnection() {
  if (redisConnection) {
    return redisConnection;
  }

  // Dynamically import ioredis only when needed

  const redisConfig: RedisOptions = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT as string),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false, // Required for BullMQ
  };

  // Add TLS configuration if not disabled
  if (!process.env.REDIS_TLS_DISABLED) {
    redisConfig.tls = {};
  }

  redisConnection = new Redis(redisConfig);

  redisConnection.on("error", (error) => {
    console.error("Redis connection error:", error);
  });

  redisConnection.on("connect", () => {
    console.log("Redis connected successfully");
  });

  return redisConnection;
}

/**
 * Close the Redis connection (useful for graceful shutdown)
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

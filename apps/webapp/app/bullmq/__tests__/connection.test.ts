import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  construct: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: class {
    constructor(options: unknown) {
      redis.construct(options);
    }
    on = redis.on;
    quit = redis.quit;
  },
}));
vi.mock("resumable-stream/ioredis", () => ({
  createResumableStreamContext: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("REDIS_HOST", "redis.example");
  vi.stubEnv("REDIS_PASSWORD", "test-password");
  vi.stubEnv("REDIS_TLS_DISABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("BullMQ Redis connection", () => {
  it.each([undefined, ""])(
    "uses Redis's default port when REDIS_PORT is %s",
    async (port) => {
      vi.stubEnv("REDIS_PORT", port);
      const { getRedisConnection } = await import("../connection");
      getRedisConnection();
      expect(redis.construct).toHaveBeenCalledWith(
        expect.objectContaining({ port: 6379 }),
      );
    },
  );
  it("preserves an explicit port, credentials and connection sharing", async () => {
    vi.stubEnv("REDIS_PORT", "6380");
    const { getRedisConnection, closeRedisConnection } = await import(
      "../connection"
    );
    const connection = getRedisConnection();
    expect(getRedisConnection()).toBe(connection);
    expect(redis.construct).toHaveBeenCalledTimes(1);
    expect(redis.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 6380,
        host: "redis.example",
        password: "test-password",
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }),
    );
    await closeRedisConnection();
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(getRedisConnection()).not.toBe(connection);
  });
});

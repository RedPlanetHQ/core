import { defineConfig } from "@trigger.dev/sdk/v3";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID as string,
  runtime: "node-22",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 1,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./app/trigger"],
  build: {
    // onnxruntime-node ships prebuilt .node binaries per platform/arch
    // and esbuild has no loader for them. Mark it external so the
    // bundler skips those requires and the runtime resolves the
    // installed native module instead.
    external: ["onnxruntime-node"],
    extensions: [
      syncEnvVars(() => ({
        // Redis creds for conversation-pubsub. Trigger.dev workers run
        // in a separate runtime and don't inherit the app's env, so
        // publishes from run-agent-turn silently no-op without these —
        // manifesting as "conversation view stuck on Working…, refresh
        // shows the reply". Only these get synced because everything
        // else the worker touches (DB, model keys, etc.) is configured
        // in trigger.dev's own env dashboard.
        REDIS_HOST: process.env.REDIS_HOST as string,
        REDIS_PORT: process.env.REDIS_PORT as string,
        REDIS_PASSWORD: process.env.REDIS_PASSWORD as string,
        ...(process.env.REDIS_TLS_DISABLED
          ? { REDIS_TLS_DISABLED: process.env.REDIS_TLS_DISABLED as string }
          : {}),
      })),
      prismaExtension({
        schema: "prisma/schema.prisma",
        mode: "legacy",
      }),
    ],
  },
});

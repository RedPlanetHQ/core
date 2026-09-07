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
        // Nothing synced from the app process: everything the remaining
        // trigger.dev tasks touch (DB, model keys, etc.) is configured in
        // trigger.dev's own env dashboard, and no task that runs here
        // writes ConversationHistory rows — the jobs that do are pinned to
        // BullMQ in-process. See app/bullmq/workers/always-on.
      })),
      prismaExtension({
        schema: "prisma/schema.prisma",
        mode: "legacy",
      }),
    ],
  },
});

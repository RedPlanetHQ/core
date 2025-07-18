import { defineConfig } from "@trigger.dev/sdk/v3";
import {
  additionalPackages,
  syncEnvVars,
} from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "proj_jqsgldpqilpdnvpzyzll",
  runtime: "node",
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
    extensions: [
      syncEnvVars(() => ({
        DATABASE_URL: process.env.DATABASE_URL as string,
        API_BASE_URL: process.env.API_BASE_URL as string,
      })),
      prismaExtension({
        schema: "prisma/schema.prisma",
      }),
    ],
  },
});

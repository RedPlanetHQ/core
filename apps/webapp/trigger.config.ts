import { defineConfig } from "@trigger.dev/sdk/v3";
import {
  additionalPackages,
  syncEnvVars,
} from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID as string,
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
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY as string,
        API_BASE_URL: process.env.API_BASE_URL as string,
        DATABASE_URL: process.env.DATABASE_URL as string,
        EMBEDDING_MODEL: process.env.EMBEDDING_MODEL as string,
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY as string,
        MODEL: process.env.MODEL ?? "gpt-4.1-2025-04-14",
        NEO4J_PASSWORD: process.env.NEO4J_PASSWORD as string,
        NEO4J_URI: process.env.NEO4J_URI as string,
        NEO4J_USERNAME: process.env.NEO4J_USERNAME as string,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
      })),
      prismaExtension({
        schema: "prisma/schema.prisma",
      }),
    ],
  },
});

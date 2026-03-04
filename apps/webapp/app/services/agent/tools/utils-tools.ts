import { tool, type Tool } from "ai";
import { z } from "zod";
import { logger } from "~/services/logger.service";

export function getSleepTool(): Tool {
  return tool({
    description:
      "Pause execution for the given number of seconds (1–300). Use this to wait between polling operations, e.g. after starting a coding session before reading its output.",
    inputSchema: z.object({
      seconds: z.number().min(1).max(300).describe("Number of seconds to sleep (1–300)"),
      reason: z.string().optional().describe("Optional reason for sleeping (for logging)"),
    }),
    execute: async ({ seconds, reason }) => {
      logger.info(`Core brain: Sleeping ${seconds}s${reason ? ` — ${reason}` : ""}`);
      await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
      return { slept: seconds, ...(reason ? { reason } : {}) };
    },
  });
}

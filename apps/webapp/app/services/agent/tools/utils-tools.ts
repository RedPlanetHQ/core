import { tool, type Tool } from "ai";
import { z } from "zod";
import { logger } from "~/services/logger.service";

export function getSleepTool(): Tool {
  return tool({
    description:
      "Pause execution for the given number of seconds (1–60). Use this to wait between polling operations, e.g. after starting a coding session before reading its output. If you need to wait longer than 60 seconds, use reschedule_self instead.",
    inputSchema: z.object({
      seconds: z.number().min(1).describe("Number of seconds to sleep. Must be 60 or less — for longer waits, use reschedule_self."),
      reason: z.string().optional().describe("Optional reason for sleeping (for logging)"),
    }),
    execute: async ({ seconds, reason }) => {
      if (seconds > 60) {
        return {
          error: "sleep duration exceeds 60 seconds",
          action: "Use reschedule_self instead — call reschedule_self(minutesFromNow=<N>) to resume this task after a longer delay.",
        };
      }
      logger.info(`Core brain: Sleeping ${seconds}s${reason ? ` — ${reason}` : ""}`);
      await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
      return { slept: seconds, ...(reason ? { reason } : {}) };
    },
  });
}

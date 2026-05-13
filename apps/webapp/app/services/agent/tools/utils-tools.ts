import { tool, type Tool } from "ai";
import { z } from "zod";
import { logger } from "~/services/logger.service";

/**
 * Stream a short, observational progress update to the user.
 *
 * Available to every agent in the system — main core agent, the read
 * and write orchestrators, gateway agents, and the think agent — so
 * long-running work doesn't leave the user staring at silence. The
 * tool itself is stateless; the UI catches the tool call event and
 * renders it as a transient status line above the streaming message.
 *
 * Tone is set by each agent's own prompt:
 *   - Default: neutral, informative ("searching last month of mail",
 *     "fetching PRs assigned to you")
 *   - Onboarding: witty, observational ("you fly blr-delhi weekly")
 *
 * Hard limits enforced by prompt guidance, not code:
 *   - One sentence, max ~15 words
 *   - 5-8 total across a single delegation
 *   - Never narrate every internal step — only meaningful beats
 */
export function getProgressUpdateTool(): Tool {
  return tool({
    description:
      "Stream a single short progress observation to the user while doing long work (searches, fetches, syntheses). One sentence, specific. Use 1-2 between actions, never more than 8 total across a single delegation. Skip if the work is fast — silence is fine when results come within a couple seconds.",
    inputSchema: z.object({
      message: z
        .string()
        .describe(
          "One short sentence (max ~15 words) about what you're doing or what you just noticed. Specific, with personality when context warrants. Bad: 'working on it'. Good: 'scanning last 30 days for PRs assigned to you'.",
        ),
    }),
    execute: async ({ message }: { message: string }) => {
      logger.info(`progress_update: ${message}`);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    },
  } as any);
}

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

import { tool, type Tool } from "ai";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { type OrchestratorTools } from "../executors/base";

interface MemorySearchToolParams {
  userId: string;
  workspaceId: string;
  source: string;
  executor: OrchestratorTools;
}

/**
 * Direct memory recall for the core agent — one hop to the search API via
 * the executor abstraction (Direct in webapp, Http in workers). The butler
 * forms its own queries and calls this as often as the conversation needs;
 * errors and empty results both surface as "nothing found" (handled inside
 * the executors), which the prompt tells the butler to treat identically.
 */
export function getMemorySearchTool(params: MemorySearchToolParams): Tool {
  const { userId, workspaceId, source, executor } = params;

  return tool({
    description:
      "Their memory — everything they've told you: past conversations, decisions, preferences, people, projects. Describe your intent in full sentences, not keywords. Bad: 'slack preferences channels'. Good: 'user's preferences for slack messages — channels, formatting, standing directives'.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Full-sentence description of what you need from their memory — include who or what it's about and why you need it",
        ),
    }),
    execute: async ({ query }: { query: string }) => {
      logger.info(`Core agent: memory search - ${query}`);
      return executor.searchMemory(query, userId, workspaceId, source);
    },
  } as any);
}

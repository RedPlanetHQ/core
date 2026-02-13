import { streamText, type LanguageModel, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "~/services/logger.service";
import { getModel, getModelForTask } from "~/lib/model.server";
import { searchMemoryWithAgent } from "../memory";

const MEMORY_COMPLEXITY = "low";

const MEMORY_EXPLORER_PROMPT = `You are a Memory Explorer for CORE Memory.

TOOLS:
- memory_search: Semantic search over past conversations and stored knowledge
- memory_about_user: Get user's profile, background, preferences

CORE QUERY PATTERNS (use these formats):

Entity-centric (best for facts):
- "user's preferences for X and Y"
- "user's goals for health and cholesterol tracking"
- "project decisions about authentication implementation"

Semantic questions (best for context):
- "What feedback has Core brain given about user's diet?"
- "What progress has user made on health goals?"

Temporal (for recent work):
- "recent conversations about diet scores and meal feedback"
- "latest discussions about health tracking and goals"

BAD patterns (will fail):
- Keyword fragments: "LDL scores week"
- Generic terms alone: "preferences", "history", "recent"
- Time ranges without topic: "last 2 weeks", "30 days"

EXECUTION:
1. Form 1-2 well-structured queries using patterns above
2. Call memory_search (and memory_about_user if profile info needed)
3. Return concise summary of findings

BE PROACTIVE:
- If specific query returns empty, try a broader or related query before reporting nothing.
- If searching for "user's diet feedback" returns empty, try "user's health conversations" or "Core brain's feedback to user".
- Validate context exists before saying "nothing found".

RULES:
- One good query beats five bad ones.
- Facts only. No personality.`;

export interface MemoryExplorerResult {
  stream: any;
  startTime: number;
}

export async function runMemoryExplorer(
  query: string,
  userId: string,
  workspaceId: string,
  source: string,
  abortSignal?: AbortSignal,
): Promise<MemoryExplorerResult> {
  const startTime = Date.now();

  const tools = {
    memory_search: tool({
      description: "Search memory for relevant context using semantic queries",
      inputSchema: z.object({
        query: z.string().describe("Semantic search intent"),
      }),
      execute: async ({ query }) => {
        try {
          logger.info(`MemoryExplorer: Searching memory with query: ${query}`);

          const result = await searchMemoryWithAgent(
            query,
            userId,
            workspaceId,
            source,
            {
              structured: false,
            },
          );
          return result || "nothing found";
        } catch (error: any) {
          logger.warn("Memory search failed", error);
          return "nothing found";
        }
      },
    }),
  };

  const model = getModelForTask(MEMORY_COMPLEXITY);
  logger.info(
    `MemoryExplorer: Starting stream, complexity: ${MEMORY_COMPLEXITY}, model: ${model}`,
  );

  const modelInstance = getModel(model);

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: MEMORY_EXPLORER_PROMPT,
    messages: [{ role: "user", content: query }],
    tools,
    stopWhen: stepCountIs(3), // Reduced for speed
    abortSignal,
  });

  return {
    stream,
    startTime,
  };
}

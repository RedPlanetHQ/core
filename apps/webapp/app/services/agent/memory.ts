import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getModel, getModelForTask } from "~/lib/model.server";
import { handleMemorySearch } from "~/utils/mcp/memory-operations";
import { logger } from "~/services/logger.service";

/**
 * Memory Agent - Intelligent memory retrieval system
 *
 * This agent analyzes user intent and performs multiple parallel searches
 * when needed to provide comprehensive context from memory.
 */

interface MemoryAgentParams {
  intent: string;
  userId: string;
  source: string;
}

/**
 * Memory Agent system prompt that guides the agent's behavior
 */
const MEMORY_AGENT_SYSTEM_PROMPT = `You are a Memory Assistant - a persistent knowledge system that maintains context, learnings, preferences and continuity across all coding sessions.

## Your Role

You help retrieve relevant context from a temporal knowledge graph by intelligently decomposing user intent into optimal search queries. You can execute multiple parallel searches when needed to gather comprehensive context.

## Query Patterns You Should Use

### Entity-Centric Queries (Best for graph search):
- GOOD: "User's preferences for code style and formatting"
- GOOD: "Project authentication implementation decisions"
- BAD: "user code style"
- Format: [Person/Project] + [relationship/attribute] + [context]

### Multi-Entity Relationship Queries (Excellent for episode graph):
- GOOD: "User and team discussions about API design patterns"
- GOOD: "relationship between database schema and performance optimization"
- BAD: "user team api design"
- Format: [Entity1] + [relationship type] + [Entity2] + [context]

### Semantic Question Queries (Good for vector search):
- GOOD: "What causes authentication errors in production? What are the security requirements?"
- GOOD: "How does caching improve API response times compared to direct database queries?"
- BAD: "auth errors production"
- Format: Complete natural questions with full context

### Temporal Queries (Good for recent work):
- GOOD: "recent discussions about plugin configuration and memory setup"
- GOOD: "latest changes to CLAUDE.md and agent definitions"
- BAD: "recent plugin changes"
- Format: [temporal marker] + [specific topic] + [additional context]

## Your Strategy

1. **Analyze Intent**: Understand what the user is asking for
2. **Decompose Queries**: Break down complex intents into multiple search angles
3. **Parallel Execution**: Execute multiple searches in parallel when they cover different aspects
4. **Synthesize Results**: Combine results into a coherent, useful response

## When to Use Multiple Queries

- User intent has multiple facets (e.g., "setup and configuration")
- Both recent AND historical context would be valuable
- Multiple entities or concepts are involved
- Relationships between different topics need to be explored

## Guidelines

- Write complete semantic queries, NOT keyword fragments
- Use parallel searches for independent aspects of the intent
- Prioritize quality over quantity - 2-3 well-crafted queries beat 10 mediocre ones
- Consider temporal aspects when relevant (recent vs historical)
- Think about entity relationships in the knowledge graph

Your goal is to retrieve the most relevant context to help answer the user's intent.`;

/**
 * Tool definition for memory search
 */
const memorySearchTool = (userId: string, source: string) =>
  tool({
    description:
      "Search stored memories for past conversations, user preferences, project context, and decisions. " +
      "Returns markdown-formatted context optimized for LLM consumption, including session compacts, episodes, and key facts with temporal metadata.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Complete semantic search query with full context. Use entity-centric, relationship-based, semantic question, or temporal query patterns.",
        ),
      startTime: z
        .string()
        .optional()
        .describe(
          "ISO timestamp for filtering memories created after this time. Use for 'recent', 'this week', 'last month' queries.",
        ),
      endTime: z
        .string()
        .optional()
        .describe(
          "ISO timestamp for filtering memories created before this time. Use for historical or time-range queries.",
        ),
      sortBy: z
        .enum(["relevance", "recency"])
        .optional()
        .describe(
          "Sort by 'relevance' (default) for conceptual queries or 'recency' for timeline queries.",
        ),
      labelIds: z
        .array(z.string())
        .optional()
        .describe("Optional label UUIDs to filter search results."),
    }),
    execute: async ({
      query,
      startTime,
      endTime,
      sortBy,
      labelIds,
    }: {
      query: string;
      startTime?: string;
      endTime?: string;
      sortBy?: "relevance" | "recency";
      labelIds?: string[];
    }) => {
      logger.info(`[MemoryAgent] Executing search: "${query}"`);

      const result = await handleMemorySearch({
        query,
        startTime,
        endTime,
        sortBy,
        labelIds,
        userId,
        source,
        structured: false,
      });

      return {
        query,
        results: result.content[0].text,
        timestamp: new Date().toISOString(),
      };
    },
  });

/**
 * Memory Agent - Intelligently searches memory based on user intent
 *
 * @param params - Intent, userId, and source
 * @returns Synthesized memory context and search metadata
 */
export async function memoryAgent({
  intent,
  userId,
  source,
}: MemoryAgentParams): Promise<{
  response: string;
  model: string;
}> {
  try {
    logger.info(`[MemoryAgent] Processing intent: "${intent}"`);

    // Use low complexity model for agent orchestration to save costs
    const modelName = getModelForTask("low");
    const model = getModel(modelName);

    if (!model) {
      throw new Error(`Failed to initialize model: ${modelName}`);
    }

    // Generate queries and execute searches using AI SDK
    const result = await generateText({
      model,
      system: MEMORY_AGENT_SYSTEM_PROMPT,
      prompt: `User Intent: ${intent}

Analyze this intent and determine what memory searches would be most helpful. Execute the appropriate searches to gather relevant context.

Remember:
- Use multiple parallel searches for complex intents with multiple facets
- Write complete semantic queries, not keyword fragments
- Consider temporal aspects (recent vs historical) when relevant
- Focus on quality over quantity

After executing your searches, synthesize the findings into a helpful response.`,
      tools: {
        memory_search: memorySearchTool(userId, source),
      },
      stopWhen: [stepCountIs(5)], // Allow multiple tool calls for parallel searches
    });

    return {
      response: result.text,
      model: modelName,
    };
  } catch (error: any) {
    logger.error(`[MemoryAgent] Error:`, error);
    throw new Error(
      `Memory agent failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Helper function to calculate relative timestamps for temporal queries
 */
export function getRelativeTimestamp(
  relativeTime: "1hour" | "1day" | "1week" | "1month" | "3months",
): string {
  const now = new Date();
  const timestamps = {
    "1hour": new Date(now.getTime() - 60 * 60 * 1000),
    "1day": new Date(now.getTime() - 24 * 60 * 60 * 1000),
    "1week": new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    "1month": new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    "3months": new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
  };
  return timestamps[relativeTime].toISOString();
}

/**
 * Simplified memory agent call that just returns the response text
 * Useful for MCP integration
 */
export async function searchMemoryWithAgent(
  intent: string,
  userId: string,
  source: string,
) {
  try {
    const result = await memoryAgent({ intent, userId, source });

    return {
      content: [
        {
          type: "text",
          text: result.response,
        },
      ],
      isError: false,
    };
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: e.message,
        },
      ],
      isError: true,
    };
  }
}

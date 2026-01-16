import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getModel, getModelForTask } from "~/lib/model.server";
import { handleMemorySearch } from "~/utils/mcp/memory-operations";
import { logger } from "~/services/logger.service";
import axios from "axios";
import { SearchService } from "../search.server";

const searchService = new SearchService();

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
const MEMORY_AGENT_SYSTEM_PROMPT = `You are a Memory Assistant that retrieves relevant context from a temporal knowledge graph.

## Query Patterns

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

## Episode Marking Strategy

After executing searches and analyzing results:

1. Identify which episodes DIRECTLY answer the intent
2. Use the mark_relevant_episodes tool ONCE with an array of all relevant episode UUIDs
3. Only mark episodes that contain information closely related to the intent
4. Avoid marking tangential or loosely related episodes

Quality over quantity: prefer 2-3 highly relevant episodes over 10 loosely related ones.

## Workflow Examples

### Example 1: Simple single-facet intent
Intent: "What is the user's preferred code style?"

Step 1: Execute memory_search
- Query: "User's preferences for code style and formatting"

Step 2: Analyze results, identify relevant episodes (e.g., uuid-123, uuid-456)

Step 3: Call mark_relevant_episodes
- episode_uuids: ["uuid-123", "uuid-456"]

### Example 2: Complex multi-facet intent
Intent: "core-cli working directory, repo layout, and prior references"

Step 1: Execute parallel memory_search calls
- Query 1: "core-cli working directory path on local machine"
- Query 2: "core-cli repository layout and structure"
- Query 3: "prior references and decisions about core-cli"

Step 2: Analyze all search results, identify relevant episodes across all searches (e.g., uuid-789, uuid-012, uuid-345)

Step 3: Call mark_relevant_episodes ONCE with all relevant UUIDs
- episode_uuids: ["uuid-789", "uuid-012", "uuid-345"]

### Example 3: Recent temporal intent
Intent: "recent work on authentication"

Step 1: Execute memory_search with temporal filter
- Query: "recent discussions and work on authentication"
- sortBy: "recency"
- startTime: "2025-01-09T00:00:00.000Z" (7 days ago as ISO date string)

Step 2: Analyze results, identify relevant episodes

Step 3: Call mark_relevant_episodes
- episode_uuids: [list of relevant UUIDs]

Note: Always use ISO 8601 format for startTime/endTime: "YYYY-MM-DDTHH:mm:ss.sssZ"`;

/**
 * Tool definition for memory search
 */
const memorySearchTool = (
  userId: string,
  source: string,
  episodeCollection: Map<string, any>,
  invalidFacts: Map<string, any>,
) =>
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
          "ISO 8601 date string (e.g., '2025-01-09T00:00:00.000Z') for filtering memories created after this time. Use for 'recent', 'this week', 'last month' queries.",
        ),
      endTime: z
        .string()
        .optional()
        .describe(
          "ISO 8601 date string (e.g., '2025-01-16T23:59:59.999Z') for filtering memories created before this time. Use for historical or time-range queries.",
        ),
      sortBy: z
        .enum(["relevance", "recency"])
        .optional()
        .describe(
          "Sort by 'relevance' (default) for conceptual queries or 'recency' for timeline queries.",
        ),
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

      const result = (await searchService.search(
        query,
        userId,
        {
          startTime: startTime ? new Date(startTime) : undefined,
          endTime: endTime ? new Date(endTime) : undefined,
          sortBy,
          structured: true,
        },
        source,
      )) as any;

      // Auto-collect episodes from search results
      if (result.episodes && Array.isArray(result.episodes)) {
        result.episodes.forEach((episode: any) => {
          if (episode.uuid) {
            episodeCollection.set(episode.uuid, episode);
          }
        });
      }

      // Auto-collect episodes from search results
      if (result.invalidatedFacts && Array.isArray(result.invalidatedFacts)) {
        result.invalidatedFacts.forEach((fact: any) => {
          if (fact.factUuid) {
            invalidFacts.set(fact.factUuid, fact);
          }
        });
      }

      return {
        query,
        results: searchService.formatAsMarkdown(result.episodes, []),
        timestamp: new Date().toISOString(),
      };
    },
  });

/**
 * Tool definition for marking relevant episodes
 */
const markRelevantEpisodesTool = (relevantEpisodeUuids: Set<string>) =>
  tool({
    description:
      "Mark multiple episodes as relevant to the user's intent. Only mark episodes that directly answer the intent.",
    inputSchema: z.object({
      episode_uuids: z
        .array(z.string())
        .describe(
          "Array of episode UUIDs that are relevant to the intent. Include all episodes that directly answer the user's question.",
        ),
    }),
    execute: async ({ episode_uuids }: { episode_uuids: string[] }) => {
      episode_uuids.forEach((uuid) => relevantEpisodeUuids.add(uuid));
      logger.info(
        `[MemoryAgent] Marked ${episode_uuids.length} episodes as relevant`,
      );
      return {
        success: true,
        marked_count: episode_uuids.length,
        episode_uuids,
      };
    },
  });

/**
 * Memory Agent - Intelligently searches memory based on user intent
 *
 * @param params - Intent, userId, and source
 * @returns Filtered relevant episodes and metadata
 */
export async function memoryAgent({
  intent,
  userId,
  source,
}: MemoryAgentParams): Promise<{
  episodes: any[];
  facts: any[];
  model: string;
}> {
  try {
    logger.info(`[MemoryAgent] Processing intent: "${intent}"`);

    // Collections for episodes and relevant UUIDs
    const episodeCollection = new Map<string, any>();
    const invalidFacts = new Map<string, any>();

    const relevantEpisodeUuids = new Set<string>();

    // Use low complexity model for agent orchestration to save costs
    const modelName = getModelForTask("low");
    const model = getModel(modelName);

    if (!model) {
      throw new Error(`Failed to initialize model: ${modelName}`);
    }

    // Generate queries and execute searches using AI SDK
    await generateText({
      model,
      system: MEMORY_AGENT_SYSTEM_PROMPT,
      prompt: `User Intent: ${intent}

Execute memory searches to retrieve relevant context. Use multiple parallel searches if needed.

After analyzing search results, use mark_relevant_episodes tool to mark all episodes that directly answer this intent in a single call.`,
      tools: {
        memory_search: memorySearchTool(
          userId,
          source,
          episodeCollection,
          invalidFacts,
        ),
        mark_relevant_episodes: markRelevantEpisodesTool(relevantEpisodeUuids),
      },
      stopWhen: [stepCountIs(10)], // Allow multiple tool calls for searches + marking
    });

    // Filter and return only marked episodes
    const relevantEpisodes = Array.from(episodeCollection.values()).filter(
      (episode) => relevantEpisodeUuids.has(episode.uuid),
    );

    logger.info(
      `[MemoryAgent] Returning ${relevantEpisodes.length} relevant episodes out of ${episodeCollection.size} total`,
    );

    return {
      episodes: relevantEpisodes,
      facts: Array.from(invalidFacts.values()),
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
 * Simplified memory agent call that returns relevant episodes
 * Useful for MCP integration
 */
export async function searchMemoryWithAgent(
  intent: string,
  userId: string,
  source: string,
) {
  try {
    const result = await memoryAgent({ intent, userId, source });

    // Format episodes as readable text
    const episodeText = result.episodes
      .map((episode, index) => {
        return `### Episode ${index + 1}\n**UUID**: ${episode.uuid}\n**Created**: ${new Date(episode.createdAt).toLocaleString()}\n${episode.relevanceScore ? `**Relevance**: ${episode.relevanceScore}\n` : ""}\n${episode.content}`;
      })
      .join("\n\n");

    const factsText = result.facts
      .map((fact, index) => {
        return `### Invalid facts ${index + 1}\n**UUID**: ${fact.factUuid}\n**InvalidAt**: ${new Date(fact.invalidAt).toLocaleString()}\n${fact.fact}`;
      })
      .join("\n\n");

    const finalText = `${episodeText}\n\n${factsText}`;

    return {
      content: [
        {
          type: "text",
          text: episodeText
            ? finalText
            : "No relevant episodes found for this intent in memory.",
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

import { generateObject } from "ai";
import { z } from "zod";
import { getModel, getModelForTask } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { SearchService } from "../search.server";
import { searchV2 } from "../search-v2";
import { prisma } from "~/db.server";

const searchService = new SearchService();

/**
 * Check if search result has meaningful content
 */
function hasSearchResults(result: any): boolean {
  if (!result) return false;

  if (typeof result === "object" && "episodes" in result) {
    return (
      result.episodes.length > 0 ||
      (result.entity !== null && result.entity !== undefined) ||
      (result.statements && result.statements.length > 0)
    );
  }

  return false;
}

/**
 * Memory Agent - Intelligent memory retrieval system
 *
 * This agent analyzes user intent and performs multiple parallel searches
 * when needed to provide comprehensive context from memory.
 */

interface MemoryAgentParams {
  intent: string;
  userId: string;
  workspaceId: string;
  source: string;
}

/**
 * Memory Agent system prompt that guides the agent's behavior
 */
const MEMORY_AGENT_SYSTEM_PROMPT = `You are a Memory Query Generator that decomposes user intents into optimized search queries.

Your job is to analyze the user's intent and generate one or more targeted search queries that will retrieve relevant context from a temporal knowledge graph.

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

## Query Generation Strategy

Break down complex intents into multiple focused queries:

### Example 1: Simple intent
Intent: "What is the user's preferred code style?"
Output: ["User's preferences for code style and formatting"]

### Example 2: Complex multi-facet intent
Intent: "Help me write a blog post"
Output: [
  "User's writing style preferences and tone",
  "Blog post examples user has created",
  "User's preferred blog structure and format"
]

### Example 3: Project context intent
Intent: "core-cli working directory, repo layout, and prior references"
Output: [
  "core-cli working directory path on local machine",
  "core-cli repository layout and structure",
  "prior references and decisions about core-cli"
]

### Example 4: Recent temporal intent
Intent: "recent work on authentication"
Output: ["recent discussions and work on authentication"]

## Instructions

1. Analyze the user's intent carefully
2. Identify all facets that need to be searched (1-5 queries maximum)
3. Generate complete, semantic search queries
4. Each query should be self-contained and specific
5. Prioritize quality over quantity`;

/**
 * Memory Agent - Intelligently searches memory based on user intent
 *
 * @param params - Intent, userId, and source
 * @returns Filtered relevant episodes and metadata
 */
export async function memoryAgent({
  intent,
  userId,
  workspaceId,
  source,
}: MemoryAgentParams): Promise<{
  episodes: any[];
  facts: any[];
}> {
  try {
    logger.info(`[MemoryAgent] Processing intent: "${intent}"`);

    // Use low complexity model for query generation to save costs
    const modelName = getModelForTask("low");
    const model = getModel(modelName);

    if (!model) {
      throw new Error(`Failed to initialize model: ${modelName}`);
    }

    // Step 1: Generate queries using LLM
    const { object: queryObject } = await generateObject({
      model,
      system: MEMORY_AGENT_SYSTEM_PROMPT,
      prompt: `User Intent: ${intent}

Generate 1-5 optimized search queries to retrieve relevant context from memory.`,
      schema: z.object({
        queries: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe("Array of search queries to execute"),
      }),
      providerOptions: {
        openai: {
          strictJsonSchema: false,
        },
      },
    });

    const queries = queryObject.queries;
    logger.info(
      `[MemoryAgent] Generated ${queries.length} queries: ${JSON.stringify(queries)}`,
    );

    // Step 2: Execute all searches in parallel
    const searchResults = await Promise.all(
      queries.map(async (query) => {
        logger.info(`[MemoryAgent] Executing search: "${query}"`);
        const result = (await searchService.search(
          query,
          userId,
          workspaceId,
          {
            structured: true,
            limit: 20, // Get top 10 per query
          },
          source,
        )) as any;

        return result;
      }),
    );

    // Step 3: Combine all episodes and deduplicate
    const episodeMap = new Map<
      string,
      {
        episode: any;
        maxScore: number;
      }
    >();
    const factsMap = new Map<string, any>();

    searchResults.forEach((result) => {
      // Collect episodes with max relevance score
      if (result.episodes && Array.isArray(result.episodes)) {
        result.episodes.forEach((episode: any) => {
          if (episode.uuid) {
            const currentScore = episode.relevanceScore || 0;
            const existing = episodeMap.get(episode.uuid);

            if (!existing || currentScore > existing.maxScore) {
              episodeMap.set(episode.uuid, {
                episode,
                maxScore: currentScore,
              });
            }
          }
        });
      }

      // Collect invalidated facts
      if (result.invalidatedFacts && Array.isArray(result.invalidatedFacts)) {
        result.invalidatedFacts.forEach((fact: any) => {
          if (fact.factUuid && !factsMap.has(fact.factUuid)) {
            factsMap.set(fact.factUuid, fact);
          }
        });
      }
    });

    // Step 4: Sort by score and return top episodes
    const sortedEpisodes = Array.from(episodeMap.values())
      .sort((a, b) => b.maxScore - a.maxScore)
      .map((item) => ({
        ...item.episode,
        relevanceScore: item.maxScore,
      }))
      .slice(0, 10); // Return top 10 overall

    logger.info(
      `[MemoryAgent] Returning ${sortedEpisodes.length} episodes (deduped from ${episodeMap.size} total unique episodes)`,
    );

    return {
      episodes: sortedEpisodes,
      facts: Array.from(factsMap.values()),
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

interface SearchMemoryOptions {
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  labelIds?: string[];
  structured?: boolean;
  sortBy?: "relevance" | "recency";
  fallbackThreshold?: number;
  adaptiveFiltering?: boolean;
}

/**
 * Simplified memory agent call that returns relevant episodes
 * Uses parallel V1/V2 search strategy:
 * - V2: Uses raw intent directly (V2 handles decomposition internally)
 * - V1: Falls back to memoryAgent which decomposes into multiple queries
 * Useful for MCP integration and API
 *
 * @param options.structured - If true, returns raw JSON data. If false (default), returns MCP-style text format.
 */
export async function searchMemoryWithAgent(
  intent: string,
  userId: string,
  workspaceId: string,
  source: string,
  options: SearchMemoryOptions = {},
) {
  try {
    // Check workspace version to determine search strategy
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId },
      select: { version: true },
    });
    const isV3User = workspace?.version === "V3";

    logger.info(
      `[MemoryAgent] Starting search for intent: "${intent}" (workspace version: ${workspace?.version || "unknown"}, V1 fallback: ${!isV3User})`,
    );

    // For V3 users: V2 only (no V1 fallback - all their data is V2-compatible)
    // For V1/V2 users: parallel V1/V2 with V2-first, V1-fallback
    const v1Promise = isV3User
      ? null
      : memoryAgent({ intent, userId, workspaceId, source });

    const v2Promise = searchV2(intent, userId, {
      structured: true,
      limit: options.limit ?? 20,
      workspaceId,
      source,
      startTime: options.startTime,
      endTime: options.endTime,
      labelIds: options.labelIds,
      sortBy: options.sortBy,
      fallbackThreshold: options.fallbackThreshold,
    });

    // Wait for V2 first (it's faster)
    const v2Result = await v2Promise.catch((err) => {
      logger.warn(`[MemoryAgent] V2 search failed:`, err.message);
      return null;
    });

    let episodes: any[] = [];
    let invalidFacts: any[] = [];
    let entity: any = null;
    let facts: any[] = [];
    let usedVersion: "v1" | "v2" = "v2";

    if (hasSearchResults(v2Result)) {
      logger.info(`[MemoryAgent] Using V2 results`);
      // V2 result is structured, extract all fields
      const v2Structured = v2Result as any;
      episodes = v2Structured.episodes || [];
      invalidFacts = v2Structured.invalidatedFacts || [];
      entity = v2Structured.entity || null;
      facts = v2Structured.facts || [];
    } else if (!isV3User && v1Promise) {
      // V2 empty and V1 fallback enabled - wait for V1 (already running in parallel)
      logger.info(`[MemoryAgent] V2 empty, using V1 fallback`);
      const v1Result = await v1Promise.catch((err) => {
        logger.error(`[MemoryAgent] V1 also failed:`, err.message);
        return { episodes: [], facts: [] };
      });
      episodes = v1Result.episodes || [];
      invalidFacts = v1Result.facts || [];
      usedVersion = "v1";
    } else {
      // V3 user with empty V2 results - no fallback
      logger.info(`[MemoryAgent] V2 empty, no V1 fallback for V3 user`);
    }

    logger.info(
      `[MemoryAgent] Returning ${episodes.length} episodes, ${facts.length} facts, entity: ${entity ? "yes" : "no"} using ${usedVersion}`,
    );

    // If structured option is true, return raw JSON data for API use
    if (options.structured) {
      return {
        episodes,
        facts,
        invalidatedFacts: invalidFacts,
        entity,
        version: usedVersion,
      };
    }

    // Format entity information
    let entityText = "";
    if (entity) {
      entityText = `## Entity Information\n**Name**: ${entity.name}\n**UUID**: ${entity.uuid}`;
      if (entity.attributes && Object.keys(entity.attributes).length > 0) {
        entityText += "\n**Attributes**:";
        for (const [key, value] of Object.entries(entity.attributes)) {
          entityText += `\n- ${key}: ${value}`;
        }
      }
      entityText += "\n\n";
    }

    // Format facts
    let factsText = "";
    if (facts.length > 0) {
      factsText =
        "## Facts\n" +
        facts
          .map((fact: any) => {
            const date = new Date(fact.validAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const aspectTag = fact.aspect ? `[${fact.aspect}] ` : "";
            return `- ${aspectTag}${fact.fact} _(${date})_`;
          })
          .join("\n") +
        "\n\n";
    }

    // Format episodes as readable text
    const episodeText = episodes
      .map((episode: any, index: number) => {
        return `### Episode ${index + 1}\n**UUID**: ${episode.uuid}\n**Created**: ${new Date(episode.createdAt).toLocaleString()}\n${episode.relevanceScore ? `**Relevance**: ${episode.relevanceScore}\n` : ""}\n${episode.content}`;
      })
      .join("\n\n");

    const invalidFactsText = invalidFacts
      .map((fact: any, index: number) => {
        return `### Invalid facts ${index + 1}\n**UUID**: ${fact.factUuid}\n**InvalidAt**: ${new Date(fact.invalidAt).toLocaleString()}\n${fact.fact}`;
      })
      .join("\n\n");

    const finalText =
      `${entityText}${invalidFactsText}${episodeText}\n\n${factsText}`.trim();

    const hasContent =
      episodeText || entityText || invalidFactsText || factsText;

    return {
      content: [
        {
          type: "text",
          text: hasContent
            ? finalText
            : "No relevant memories found for this intent.",
        },
      ],
      isError: false,
    };
  } catch (e: any) {
    // For structured mode, throw the error to let API handle it
    if (options.structured) {
      throw e;
    }
    // For MCP text mode, return error in MCP format
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

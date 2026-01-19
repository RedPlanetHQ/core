import { generateObject } from "ai";
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

import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";
import { makeModelCall } from "~/lib/model.server";
import { runQuery } from "~/lib/neo4j.server";
import { updateSpaceStatus, SPACE_STATUS } from "~/trigger/utils/space-status";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { getSpace, updateSpace } from "~/trigger/utils/space-utils";
import { getSpaceEpisodeCount } from "~/services/graphModels/space";
import { EPISODIC_NODE_PROPERTIES, EpisodicNode } from "@core/types";
import { parseEpisodicNode } from "~/services/graphModels/episode";

export interface SpaceSummaryPayload {
  userId: string;
  spaceId: string; // Single space only
  triggerSource?: "assignment" | "manual" | "scheduled";
}

interface SpaceSummaryData {
  spaceId: string;
  spaceName: string;
  spaceDescription?: string;
  contextCount: number;
  summary: string;
  keyEntities: string[];
  themes: string[];
  confidence: number;
  lastUpdated: Date;
  isIncremental: boolean;
}

// Zod schema for LLM response validation
const SummaryResultSchema = z.object({
  summary: z.string(),
  keyEntities: z.array(z.string()),
  themes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const CONFIG = {
  maxEpisodesForSummary: 20, // Limit episodes for performance
  minEpisodesForSummary: 1, // Minimum episodes to generate summary
  summaryEpisodeThreshold: 5, // Minimum new episodes required to trigger summary (configurable)
};

export interface SpaceSummaryResult {
  success: boolean;
  spaceId: string;
  triggerSource: string;
  summary?: {
    statementCount: number;
    confidence: number;
    themesCount: number;
  } | null;
  reason?: string;
}

/**
 * Core business logic for space summary generation
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processSpaceSummary(
  payload: SpaceSummaryPayload,
): Promise<SpaceSummaryResult> {
  const { userId, spaceId, triggerSource = "manual" } = payload;

  logger.info(`Starting space summary generation`, {
    userId,
    spaceId,
    triggerSource,
  });

  try {
    // Update status to processing
    await updateSpaceStatus(spaceId, SPACE_STATUS.PROCESSING, {
      userId,
      operation: "space-summary",
      metadata: { triggerSource, phase: "start_summary" },
    });

    // Generate summary for the single space
    const summaryResult = await generateSpaceSummary(
      spaceId,
      userId,
      triggerSource,
    );

    if (summaryResult) {
      // Store the summary
      await storeSummary(summaryResult);

      // Update status to ready after successful completion
      await updateSpaceStatus(spaceId, SPACE_STATUS.READY, {
        userId,
        operation: "space-summary",
        metadata: {
          triggerSource,
          phase: "completed_summary",
          contextCount: summaryResult.contextCount,
          confidence: summaryResult.confidence,
        },
      });

      logger.info(`Generated summary for space ${spaceId}`, {
        statementCount: summaryResult.contextCount,
        confidence: summaryResult.confidence,
        themes: summaryResult.themes.length,
        triggerSource,
      });

      return {
        success: true,
        spaceId,
        triggerSource,
        summary: {
          statementCount: summaryResult.contextCount,
          confidence: summaryResult.confidence,
          themesCount: summaryResult.themes.length,
        },
      };
    } else {
      // No summary generated - this could be due to insufficient episodes or no new episodes
      // This is not an error state, so update status to ready
      await updateSpaceStatus(spaceId, SPACE_STATUS.READY, {
        userId,
        operation: "space-summary",
        metadata: {
          triggerSource,
          phase: "no_summary_needed",
          reason: "Insufficient episodes or no new episodes to summarize",
        },
      });

      logger.info(
        `No summary generated for space ${spaceId} - insufficient or no new episodes`,
      );
      return {
        success: true,
        spaceId,
        triggerSource,
        summary: null,
        reason: "No episodes to summarize",
      };
    }
  } catch (error) {
    // Update status to error on exception
    try {
      await updateSpaceStatus(spaceId, SPACE_STATUS.ERROR, {
        userId,
        operation: "space-summary",
        metadata: {
          triggerSource,
          phase: "exception",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } catch (statusError) {
      logger.warn(`Failed to update status to error for space ${spaceId}`, {
        statusError,
      });
    }

    logger.error(
      `Error in space summary generation for space ${spaceId}:`,
      error as Record<string, unknown>,
    );
    throw error;
  }
}

async function generateSpaceSummary(
  spaceId: string,
  userId: string,
  triggerSource?: "assignment" | "manual" | "scheduled",
): Promise<SpaceSummaryData | null> {
  try {
    // 1. Get space details
    const spaceService = new SpaceService();
    const space = await spaceService.getSpace(spaceId, userId);

    if (!space) {
      logger.warn(`Space ${spaceId} not found for user ${userId}`);
      return null;
    }

    // 2. Check episode count threshold (skip for manual triggers)
    if (triggerSource !== "manual") {
      const currentEpisodeCount = await getSpaceEpisodeCount(spaceId, userId);
      const lastSummaryEpisodeCount = space.contextCount || 0;
      const episodeDifference = currentEpisodeCount - lastSummaryEpisodeCount;

      if (
        episodeDifference < CONFIG.summaryEpisodeThreshold ||
        lastSummaryEpisodeCount !== 0
      ) {
        logger.info(
          `Skipping summary generation for space ${spaceId}: only ${episodeDifference} new episodes (threshold: ${CONFIG.summaryEpisodeThreshold})`,
          {
            currentEpisodeCount,
            lastSummaryEpisodeCount,
            episodeDifference,
            threshold: CONFIG.summaryEpisodeThreshold,
          },
        );
        return null;
      }

      logger.info(
        `Proceeding with summary generation for space ${spaceId}: ${episodeDifference} new episodes (threshold: ${CONFIG.summaryEpisodeThreshold})`,
        {
          currentEpisodeCount,
          lastSummaryEpisodeCount,
          episodeDifference,
        },
      );
    }

    // 2. Check for existing summary
    const existingSummary = await getExistingSummary(spaceId);
    const isIncremental = existingSummary !== null;

    // 3. Get episodes (all or new ones based on existing summary)
    const episodes = await getSpaceEpisodes(
      spaceId,
      userId,
      isIncremental ? existingSummary?.lastUpdated : undefined,
    );

    // Handle case where no new episodes exist for incremental update
    if (isIncremental && episodes.length === 0) {
      logger.info(
        `No new episodes found for space ${spaceId}, skipping summary update`,
      );
      return null;
    }

    // Check minimum episode requirement for new summaries only
    if (!isIncremental && episodes.length < CONFIG.minEpisodesForSummary) {
      logger.info(
        `Space ${spaceId} has insufficient episodes (${episodes.length}) for new summary`,
      );
      return null;
    }

    // 4. Process episodes using unified approach
    let summaryResult;

    if (episodes.length > CONFIG.maxEpisodesForSummary) {
      logger.info(
        `Large space detected (${episodes.length} episodes). Processing in batches.`,
      );

      // Process in batches, each building on previous result
      const batches: EpisodicNode[][] = [];
      for (let i = 0; i < episodes.length; i += CONFIG.maxEpisodesForSummary) {
        batches.push(episodes.slice(i, i + CONFIG.maxEpisodesForSummary));
      }

      let currentSummary = existingSummary?.summary || null;
      let currentThemes = existingSummary?.themes || [];
      let cumulativeConfidence = 0;

      for (const [batchIndex, batch] of batches.entries()) {
        logger.info(
          `Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} episodes`,
        );

        const batchResult = await generateUnifiedSummary(
          space.name,
          space.description as string,
          batch,
          currentSummary,
          currentThemes,
        );

        if (batchResult) {
          currentSummary = batchResult.summary;
          currentThemes = batchResult.themes;
          cumulativeConfidence += batchResult.confidence;
        } else {
          logger.warn(`Failed to process batch ${batchIndex + 1}`);
        }

        // Small delay between batches
        if (batchIndex < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      summaryResult = currentSummary
        ? {
            summary: currentSummary,
            themes: currentThemes,
            confidence: Math.min(cumulativeConfidence / batches.length, 1.0),
          }
        : null;
    } else {
      logger.info(
        `Processing ${episodes.length} episodes with unified approach`,
      );

      // Use unified approach for smaller spaces
      summaryResult = await generateUnifiedSummary(
        space.name,
        space.description as string,
        episodes,
        existingSummary?.summary || null,
        existingSummary?.themes || [],
        space.summaryStructure || null, // Pass custom structure if provided
      );
    }

    if (!summaryResult) {
      logger.warn(`Failed to generate LLM summary for space ${spaceId}`);
      return null;
    }

    // Get the actual current counts from Neo4j
    const currentEpisodeCount = await getSpaceEpisodeCount(spaceId, userId);

    return {
      spaceId: space.uuid,
      spaceName: space.name,
      spaceDescription: space.description as string,
      contextCount: currentEpisodeCount,
      summary: summaryResult.summary,
      keyEntities: summaryResult.keyEntities || [],
      themes: summaryResult.themes,
      confidence: summaryResult.confidence,
      lastUpdated: new Date(),
      isIncremental,
    };
  } catch (error) {
    logger.error(
      `Error generating summary for space ${spaceId}:`,
      error as Record<string, unknown>,
    );
    return null;
  }
}

async function generateUnifiedSummary(
  spaceName: string,
  spaceDescription: string | undefined,
  episodes: EpisodicNode[],
  previousSummary: string | null = null,
  previousThemes: string[] = [],
  summaryStructure: string | null = null, // NEW: Custom summary structure
): Promise<{
  summary: string;
  themes: string[];
  confidence: number;
  keyEntities?: string[];
} | null> {
  try {
    const prompt = createUnifiedSummaryPrompt(
      spaceName,
      spaceDescription,
      episodes,
      previousSummary,
      previousThemes,
      summaryStructure, // Pass custom structure to prompt builder
    );

    // Space summary generation requires HIGH complexity (creative synthesis, narrative generation)
    let responseText = "";
    await makeModelCall(
      false,
      prompt,
      (text: string) => {
        responseText = text;
      },
      undefined,
      "high",
    );

    return parseSummaryResponse(responseText);
  } catch (error) {
    logger.error(
      "Error generating unified summary:",
      error as Record<string, unknown>,
    );
    return null;
  }
}

function createUnifiedSummaryPrompt(
  spaceName: string,
  spaceDescription: string | undefined,
  episodes: EpisodicNode[],
  previousSummary: string | null,
  previousThemes: string[],
  summaryStructure: string | null = null, // NEW: Custom summary structure
): CoreMessage[] {
  // If there are no episodes and no previous summary, we cannot generate a meaningful summary
  if (episodes.length === 0 && previousSummary === null) {
    throw new Error(
      "Cannot generate summary without episodes or existing summary",
    );
  }

  const episodesText = episodes
    .map(
      (episode) =>
        `- ${episode.content} (Source: ${episode.source}, Session: ${episode.sessionId || "N/A"})`,
    )
    .join("\n");

  // Extract key entities and themes from episode content
  const contentWords = episodes
    .map((ep) => ep.content.toLowerCase())
    .join(" ")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  const wordFrequency = new Map<string, number>();
  contentWords.forEach((word) => {
    wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
  });

  const topEntities = Array.from(wordFrequency.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);

  const isUpdate = previousSummary !== null;

  // NEW: Build custom structure section if provided
  const customStructureSection = summaryStructure
    ? `
CUSTOM SUMMARY STRUCTURE:
The user has specified a custom structure for this space summary. You MUST organize the summary according to this structure:

${summaryStructure}

IMPORTANT: Follow the custom structure exactly. Organize your summary content to match the sections/format specified above.
`
    : "";

  return [
    {
      role: "system",
      content: `You are an expert at analyzing and summarizing episodes within semantic spaces based on the space's intent and purpose. Your task is to ${isUpdate ? "update an existing summary by integrating new episodes" : "create a comprehensive summary of episodes"}.

CRITICAL RULES:
1. Base your summary ONLY on insights derived from the actual content/episodes provided
2. Use the space's INTENT/PURPOSE (from description) to guide what to summarize and how to organize it
3. Write in a factual, neutral tone - avoid promotional language ("pivotal", "invaluable", "cutting-edge")
4. Be specific and concrete - reference actual content, patterns, and insights found in the episodes
5. If episodes are insufficient for meaningful insights, state that more data is needed
${summaryStructure ? "6. FOLLOW THE CUSTOM STRUCTURE provided by the user exactly" : ""}

${customStructureSection}

INTENT-DRIVEN SUMMARIZATION:
Your summary should SERVE the space's intended purpose. Examples:
- "Learning React" → Summarize React concepts, patterns, techniques learned
- "Project X Updates" → Summarize progress, decisions, blockers, next steps
- "Health Tracking" → Summarize metrics, trends, observations, insights
- "Guidelines for React" → Extract actionable patterns, best practices, rules
- "Evolution of design thinking" → Track how thinking changed over time, decision points
The intent defines WHY this space exists - organize content to serve that purpose.

INSTRUCTIONS:
${
  isUpdate
    ? `1. Review the existing summary and themes carefully
2. Analyze the new episodes for patterns and insights that align with the space's intent
3. Identify connecting points between existing knowledge and new episodes
4. Update the summary to seamlessly integrate new information while preserving valuable existing insights
5. Evolve themes by adding new ones or refining existing ones based on the space's purpose
6. Organize the summary to serve the space's intended use case`
    : `1. Analyze the semantic content and relationships within the episodes
2. Identify topics/sections that align with the space's INTENT and PURPOSE
3. Create a coherent summary that serves the space's intended use case
4. Organize the summary based on the space's purpose (not generic frequency-based themes)`
}
${isUpdate ? "7" : "5"}. Assess your confidence in the ${isUpdate ? "updated" : ""} summary quality (0.0-1.0)

INTENT-ALIGNED ORGANIZATION:
- Organize sections based on what serves the space's purpose
- Topics don't need minimum episode counts - relevance to intent matters most
- Each section should provide value aligned with the space's intended use
- For "guidelines" spaces: focus on actionable patterns
- For "tracking" spaces: focus on temporal patterns and changes
- For "learning" spaces: focus on concepts and insights gained
- Let the space's intent drive the structure, not rigid rules

${
  isUpdate
    ? `CONNECTION FOCUS:
- Entity relationships that span across batches/time
- Theme evolution and expansion
- Temporal patterns and progressions
- Contradictions or confirmations of existing insights
- New insights that complement existing knowledge`
    : ""
}

RESPONSE FORMAT:
Provide your response inside <output></output> tags with valid JSON. Include both HTML summary and markdown format.

<output>
{
  "summary": "${isUpdate ? "Updated HTML summary that integrates new insights with existing knowledge. Write factually about what the statements reveal - mention specific entities, relationships, and patterns found in the data. Avoid marketing language. Use HTML tags for structure." : "Factual HTML summary based on patterns found in the statements. Report what the data actually shows - specific entities, relationships, frequencies, and concrete insights. Avoid promotional language. Use HTML tags like <p>, <strong>, <ul>, <li> for structure. Keep it concise and evidence-based."}",
  "keyEntities": ["entity1", "entity2", "entity3"],
  "themes": ["${isUpdate ? 'updated_theme1", "new_theme2", "evolved_theme3' : 'theme1", "theme2", "theme3'}"],
  "confidence": 0.85
}
</output>

JSON FORMATTING RULES:
- HTML content in summary field is allowed and encouraged
- Escape quotes within strings as \"
- Escape HTML angle brackets if needed: &lt; and &gt;
- Use proper HTML tags for structure: <p>, <strong>, <em>, <ul>, <li>, <h3>, etc.
- HTML content should be well-formed and semantic

GUIDELINES:
${
  isUpdate
    ? `- Preserve valuable insights from existing summary
- Integrate new information by highlighting connections
- Themes should evolve naturally, don't replace wholesale
- The updated summary should read as a coherent whole
- Make the summary user-friendly and explain what value this space provides`
    : `- Report only what the episodes actually reveal - be specific and concrete
- Cite actual content and patterns found in the episodes
- Avoid generic descriptions that could apply to any space
- Use neutral, factual language - no "comprehensive", "robust", "cutting-edge" etc.
- Themes must be backed by at least 3 supporting episodes with clear evidence
- Better to have fewer, well-supported themes than many weak ones
- Confidence should reflect actual data quality and coverage, not aspirational goals`
}`,
    },
    {
      role: "user",
      content: `SPACE INFORMATION:
Name: "${spaceName}"
Intent/Purpose: ${spaceDescription || "No specific intent provided - organize naturally based on content"}

${
  isUpdate
    ? `EXISTING SUMMARY:
${previousSummary}

EXISTING THEMES:
${previousThemes.join(", ")}

NEW EPISODES TO INTEGRATE (${episodes.length} episodes):`
    : `EPISODES IN THIS SPACE (${episodes.length} episodes):`
}
${episodesText}

${
  episodes.length > 0
    ? `TOP WORDS BY FREQUENCY:
${topEntities.join(", ")}`
    : ""
}

${customStructureSection ? `\nREMINDER: Structure your summary according to the CUSTOM SUMMARY STRUCTURE specified above.\n` : ""}

${
  isUpdate
    ? "Please identify connections between the existing summary and new episodes, then update the summary to integrate the new insights coherently. Organize the summary to SERVE the space's intent/purpose. Remember: only summarize insights from the actual episode content."
    : "Please analyze the episodes and provide a comprehensive summary that SERVES the space's intent/purpose. Organize sections based on what would be most valuable for this space's intended use case. If the intent is unclear, organize naturally based on content patterns. Only summarize insights from actual episode content."
}`,
    },
  ];
}

async function getExistingSummary(spaceId: string): Promise<{
  summary: string;
  themes: string[];
  lastUpdated: Date;
  contextCount: number;
} | null> {
  try {
    const existingSummary = await getSpace(spaceId);

    if (existingSummary?.summary) {
      return {
        summary: existingSummary.summary,
        themes: existingSummary.themes,
        lastUpdated: existingSummary.summaryGeneratedAt || new Date(),
        contextCount: existingSummary.contextCount || 0,
      };
    }

    return null;
  } catch (error) {
    logger.warn(`Failed to get existing summary for space ${spaceId}:`, {
      error,
    });
    return null;
  }
}

async function getSpaceEpisodes(
  spaceId: string,
  userId: string,
  sinceDate?: Date,
): Promise<EpisodicNode[]> {
  // Query episodes directly using Space-[:HAS_EPISODE]->Episode relationships
  const params: any = { spaceId, userId };

  let dateCondition = "";
  if (sinceDate) {
    dateCondition = "AND e.createdAt > $sinceDate";
    params.sinceDate = sinceDate.toISOString();
  }

  const query = `
    MATCH (space:Space {uuid: $spaceId, userId: $userId})-[:HAS_EPISODE]->(e:Episode {userId: $userId})
    WHERE e IS NOT NULL ${dateCondition}
    RETURN DISTINCT ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY episode.createdAt DESC
  `;

  const result = await runQuery(query, params);

  return result.map((record) => {
    return parseEpisodicNode(record.get("episode"));
  });
}

function parseSummaryResponse(response: string): {
  summary: string;
  themes: string[];
  confidence: number;
  keyEntities?: string[];
} | null {
  try {
    // Extract content from <output> tags
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn("No <output> tags found in LLM summary response");
      logger.debug("Full LLM response:", { response });
      return null;
    }

    let jsonContent = outputMatch[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (jsonError) {
      logger.warn("JSON parsing failed, attempting cleanup and retry", {
        originalError: jsonError,
        jsonContent: jsonContent.substring(0, 500) + "...", // Log first 500 chars
      });

      // More aggressive cleanup for malformed JSON
      jsonContent = jsonContent
        .replace(/([^\\])"/g, '$1\\"') // Escape unescaped quotes
        .replace(/^"/g, '\\"') // Escape quotes at start
        .replace(/\\\\"/g, '\\"'); // Fix double-escaped quotes

      parsed = JSON.parse(jsonContent);
    }

    // Validate the response structure
    const validationResult = SummaryResultSchema.safeParse(parsed);
    if (!validationResult.success) {
      logger.warn("Invalid LLM summary response format:", {
        error: validationResult.error,
        parsedData: parsed,
      });
      return null;
    }

    return validationResult.data;
  } catch (error) {
    logger.error(
      "Error parsing LLM summary response:",
      error as Record<string, unknown>,
    );
    logger.debug("Failed response content:", { response });
    return null;
  }
}

async function storeSummary(summaryData: SpaceSummaryData): Promise<void> {
  try {
    // Store in PostgreSQL for API access and persistence
    await updateSpace(summaryData);

    // Also store in Neo4j for graph-based queries
    const query = `
      MATCH (space:Space {uuid: $spaceId})
      SET space.summary = $summary,
          space.keyEntities = $keyEntities,
          space.themes = $themes,
          space.summaryConfidence = $confidence,
          space.summaryContextCount = $contextCount,
          space.summaryLastUpdated = datetime($lastUpdated)
      RETURN space
    `;

    await runQuery(query, {
      spaceId: summaryData.spaceId,
      summary: summaryData.summary,
      keyEntities: summaryData.keyEntities,
      themes: summaryData.themes,
      confidence: summaryData.confidence,
      contextCount: summaryData.contextCount,
      lastUpdated: summaryData.lastUpdated.toISOString(),
    });

    logger.info(`Stored summary for space ${summaryData.spaceId}`, {
      themes: summaryData.themes.length,
      keyEntities: summaryData.keyEntities.length,
      confidence: summaryData.confidence,
    });
  } catch (error) {
    logger.error(
      `Error storing summary for space ${summaryData.spaceId}:`,
      error as Record<string, unknown>,
    );
    throw error;
  }
}

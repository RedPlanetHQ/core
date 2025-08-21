import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";
import { makeModelCall } from "~/lib/model.server";
import { runQuery } from "~/lib/neo4j.server";
import { updateSpaceStatus, SPACE_STATUS } from "../utils/space-status";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import { spacePatternTask, triggerSpacePattern } from "./space-pattern";

interface SpaceSummaryPayload {
  userId: string;
  workspaceId: string;
  spaceId: string; // Single space only
  triggerSource?: "assignment" | "manual" | "scheduled";
}

interface SpaceStatementData {
  uuid: string;
  fact: string;
  subject: string;
  predicate: string;
  object: string;
  createdAt: Date;
  validAt: Date;
}

interface SpaceSummaryData {
  spaceId: string;
  spaceName: string;
  spaceDescription?: string;
  statementCount: number;
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
  maxStatementsForSummary: 200, // Limit statements for performance
  minStatementsForSummary: 3, // Minimum statements to generate summary
  summaryPromptTokenLimit: 4000, // Approximate token limit for prompt
};

export const spaceSummaryQueue = queue({
  name: "space-summary-queue",
  concurrencyLimit: 1,
});

export const spaceSummaryTask = task({
  id: "space-summary",
  queue: spaceSummaryQueue,
  run: async (payload: SpaceSummaryPayload) => {
    const { userId, workspaceId, spaceId, triggerSource = "manual" } = payload;

    logger.info(`Starting space summary generation`, {
      userId,
      workspaceId,
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
      const summaryResult = await generateSpaceSummary(spaceId, userId);

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
            statementCount: summaryResult.statementCount,
            confidence: summaryResult.confidence,
          },
        });

        logger.info(`Generated summary for space ${spaceId}`, {
          statementCount: summaryResult.statementCount,
          confidence: summaryResult.confidence,
          themes: summaryResult.themes.length,
          triggerSource,
        });

        if (!summaryResult.isIncremental && summaryResult.statementCount > 0) {
          await triggerSpacePattern({
            userId,
            workspaceId,
            spaceId,
            triggerSource: "summary_complete",
          });
        }

        return {
          success: true,
          spaceId,
          triggerSource,
          summary: {
            statementCount: summaryResult.statementCount,
            confidence: summaryResult.confidence,
            themesCount: summaryResult.themes.length,
          },
        };
      } else {
        // Update status to error if summary generation fails
        await updateSpaceStatus(spaceId, SPACE_STATUS.ERROR, {
          userId,
          operation: "space-summary",
          metadata: { triggerSource, phase: "failed_summary", error: "Failed to generate summary" },
        });

        logger.warn(`Failed to generate summary for space ${spaceId}`);
        return {
          success: false,
          spaceId,
          triggerSource,
          error: "Failed to generate summary",
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
            error: error instanceof Error ? error.message : "Unknown error"
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
  },
});

async function generateSpaceSummary(
  spaceId: string,
  userId: string,
): Promise<SpaceSummaryData | null> {
  try {
    // 1. Get space details
    const spaceService = new SpaceService();
    const space = await spaceService.getSpace(spaceId, userId);

    if (!space) {
      logger.warn(`Space ${spaceId} not found for user ${userId}`);
      return null;
    }

    // 2. Check for existing summary
    const existingSummary = await getExistingSummary(spaceId);
    const isIncremental = existingSummary !== null;

    // 3. Get statements (all or new ones based on existing summary)
    const statements = await getSpaceStatements(
      spaceId,
      userId,
      existingSummary?.lastUpdated,
    );

    // Handle case where no new statements exist for incremental update
    if (isIncremental && statements.length === 0) {
      logger.info(
        `No new statements found for space ${spaceId}, skipping summary update`,
      );
      return null;
    }

    // Check minimum statement requirement for new summaries only
    if (!isIncremental && statements.length < CONFIG.minStatementsForSummary) {
      logger.info(
        `Space ${spaceId} has insufficient statements (${statements.length}) for new summary`,
      );
      return null;
    }

    // 4. Process statements using unified approach
    let summaryResult;

    if (statements.length > CONFIG.maxStatementsForSummary) {
      logger.info(
        `Large space detected (${statements.length} statements). Processing in batches.`,
      );

      // Process in batches, each building on previous result
      const batches: SpaceStatementData[][] = [];
      for (
        let i = 0;
        i < statements.length;
        i += CONFIG.maxStatementsForSummary
      ) {
        batches.push(statements.slice(i, i + CONFIG.maxStatementsForSummary));
      }

      let currentSummary = existingSummary?.summary || null;
      let currentThemes = existingSummary?.themes || [];
      let cumulativeConfidence = 0;

      for (const [batchIndex, batch] of batches.entries()) {
        logger.info(
          `Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} statements`,
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
        `Processing ${statements.length} statements with unified approach`,
      );

      // Use unified approach for smaller spaces
      summaryResult = await generateUnifiedSummary(
        space.name,
        space.description as string,
        statements,
        existingSummary?.summary || null,
        existingSummary?.themes || [],
      );
    }

    if (!summaryResult) {
      logger.warn(`Failed to generate LLM summary for space ${spaceId}`);
      return null;
    }

    return {
      spaceId: space.uuid,
      spaceName: space.name,
      spaceDescription: space.description as string,
      statementCount: statements.length,
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
  statements: SpaceStatementData[],
  previousSummary: string | null = null,
  previousThemes: string[] = [],
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
      statements,
      previousSummary,
      previousThemes,
    );

    let responseText = "";
    await makeModelCall(false, prompt, (text: string) => {
      responseText = text;
    });

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
  statements: SpaceStatementData[],
  previousSummary: string | null,
  previousThemes: string[],
): CoreMessage[] {
  const statementsText = statements
    .map(
      (stmt) =>
        `- ${stmt.fact} (${stmt.subject} → ${stmt.predicate} → ${stmt.object})`,
    )
    .join("\n");

  const entityFrequency = new Map<string, number>();
  statements.forEach((stmt) => {
    [stmt.subject, stmt.object].forEach((entity) => {
      entityFrequency.set(entity, (entityFrequency.get(entity) || 0) + 1);
    });
  });

  const topEntities = Array.from(entityFrequency.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([entity]) => entity);

  const isUpdate = previousSummary !== null;

  return [
    {
      role: "system",
      content: `You are an expert at analyzing and summarizing structured knowledge within semantic spaces. Your task is to ${isUpdate ? "update an existing summary by integrating new statements" : "create a comprehensive summary of statements"}.

INSTRUCTIONS:
${
  isUpdate
    ? `1. Review the existing summary and themes carefully
2. Analyze the new statements for patterns and insights  
3. Identify connecting points between existing knowledge and new statements
4. Update the summary to seamlessly integrate new information while preserving valuable existing insights
5. Evolve themes by adding new ones or refining existing ones based on connections found`
    : `1. Analyze the semantic content and relationships within the statements
2. Identify the main themes and patterns across all statements
3. Create a coherent summary that captures the essence of this knowledge domain`
}
6. Assess your confidence in the ${isUpdate ? "updated" : ""} summary quality (0.0-1.0)

THEME IDENTIFICATION RULES:
- A theme must be supported by AT LEAST 5 related statements to be considered valid
- Themes should represent substantial, meaningful patterns rather than minor occurrences
- Each theme must capture a distinct semantic domain or conceptual area
- Only identify themes that have sufficient evidence in the data
- If fewer than 5 statements support a potential theme, do not include it

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
Provide your response inside <output></output> tags with valid JSON. The summary should be formatted as HTML for better presentation.

<output>
{
  "summary": "${isUpdate ? "Updated HTML summary that integrates new insights with existing knowledge through identified connections. Use HTML tags like <p>, <strong>, <em>, <ul>, <li> to structure and emphasize key information. The summary should clearly explain what this space contains, what topics are covered, and what users can learn from it." : "A comprehensive 2-3 paragraph HTML summary that clearly explains what this space contains, what knowledge domains it covers, and what insights users can gain. Use HTML tags like <p>, <strong>, <em>, <ul>, <li> to structure and emphasize key information for better readability. Focus on making the content accessible and understandable to users who want to know what they'll find in this space."}",
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
    : `- Summary should clearly communicate what this space is about and what users will find
- Focus on practical value - what knowledge, insights, or information does this space contain?
- Use accessible language that helps users understand the space's purpose and content
- Format the summary using HTML tags for better visual presentation and readability
- Themes must be backed by at least 5 supporting statements
- Only include themes with substantial evidence - better to have fewer, well-supported themes than many weak ones
- Confidence should reflect data quality, coherence, coverage, and theme strength`
}`,
    },
    {
      role: "user",
      content: `SPACE INFORMATION:
Name: "${spaceName}"
Description: ${spaceDescription || "No description provided"}

${
  isUpdate
    ? `EXISTING SUMMARY:
${previousSummary}

EXISTING THEMES:
${previousThemes.join(", ")}

NEW STATEMENTS TO INTEGRATE (${statements.length} statements):`
    : `STATEMENTS IN THIS SPACE (${statements.length} statements):`
}
${statementsText}

${
  statements.length > 0
    ? `TOP ENTITIES BY FREQUENCY:
${topEntities.join(", ")}`
    : ""
}

${
  isUpdate
    ? "Please identify connections between the existing summary and new statements, then update the summary to integrate the new insights coherently."
    : "Please analyze this space and provide a comprehensive summary that captures its semantic content and major themes."
}`,
    },
  ];
}

async function getExistingSummary(spaceId: string): Promise<{
  summary: string;
  themes: string[];
  lastUpdated: Date;
} | null> {
  try {
    const existingSummary = await prisma.space.findUnique({
      where: { id: spaceId },
    });

    if (existingSummary?.summary) {
      return {
        summary: existingSummary.summary,
        themes: existingSummary.themes,
        lastUpdated: existingSummary.updatedAt,
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

async function getSpaceStatements(
  spaceId: string,
  userId: string,
  sinceDate?: Date,
): Promise<SpaceStatementData[]> {
  // Build query with optional date filter for incremental updates
  let whereClause =
    "s.userId = $userId AND s.spaceIds IS NOT NULL AND $spaceId IN s.spaceIds AND s.invalidAt IS NULL";
  const params: any = { spaceId, userId };

  if (sinceDate) {
    whereClause += " AND s.createdAt > $sinceDate";
    params.sinceDate = sinceDate.toISOString();
  }

  const query = `
    MATCH (s:Statement)
    WHERE ${whereClause}
    MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
    MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
    MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
    RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
    ORDER BY s.createdAt DESC
  `;

  const result = await runQuery(query, params);

  return result.map((record) => {
    const statement = record.get("s").properties;
    return {
      uuid: statement.uuid,
      fact: statement.fact,
      subject: record.get("subject"),
      predicate: record.get("predicate"),
      object: record.get("object"),
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: new Date(statement.invalidAt),
    };
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

    // Clean up common JSON formatting issues from LLM responses
    jsonContent = jsonContent
      .replace(/[\u0000-\u001F\u007F]/g, "") // Remove control characters
      .replace(/\n/g, "\\n") // Escape newlines
      .replace(/\r/g, "\\r") // Escape carriage returns
      .replace(/\t/g, "\\t") // Escape tabs
      .replace(/\\/g, "\\\\") // Escape backslashes (but avoid double escaping)
      .replace(/\\\\n/g, "\\n") // Fix double-escaped newlines
      .replace(/\\\\r/g, "\\r") // Fix double-escaped carriage returns
      .replace(/\\\\t/g, "\\t"); // Fix double-escaped tabs

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
    await prisma.space.update({
      where: {
        id: summaryData.spaceId,
      },
      data: {
        summary: summaryData.summary,
        themes: summaryData.themes,
        statementCount: summaryData.statementCount,
      },
    });

    // Also store in Neo4j for graph-based queries
    const query = `
      MATCH (space:Space {uuid: $spaceId})
      SET space.summary = $summary,
          space.keyEntities = $keyEntities,
          space.themes = $themes,
          space.summaryConfidence = $confidence,
          space.summaryStatementCount = $statementCount,
          space.summaryLastUpdated = datetime($lastUpdated)
      RETURN space
    `;

    await runQuery(query, {
      spaceId: summaryData.spaceId,
      summary: summaryData.summary,
      keyEntities: summaryData.keyEntities,
      themes: summaryData.themes,
      confidence: summaryData.confidence,
      statementCount: summaryData.statementCount,
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

// Helper function to trigger the task
export async function triggerSpaceSummary(payload: SpaceSummaryPayload) {
  return await spaceSummaryTask.trigger(payload, {
    queue: "space-summary-queue",
    concurrencyKey: payload.userId,
    tags: [payload.userId, payload.spaceId],
  });
}

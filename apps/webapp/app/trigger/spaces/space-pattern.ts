import { task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import { makeModelCall } from "~/lib/model.server";
import { runQuery } from "~/lib/neo4j.server";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import {
  EXPLICIT_PATTERN_TYPES,
  IMPLICIT_PATTERN_TYPES,
  type SpacePattern,
  type PatternDetectionResult,
  type UserConfirmationStatus,
} from "@core/types";

interface SpacePatternPayload {
  userId: string;
  workspaceId: string;
  spaceId: string;
  triggerSource?: "summary_complete" | "manual" | "scheduled" | "new_space" | "growth_threshold" | "ingestion_complete";
}

interface SpaceStatementData {
  uuid: string;
  fact: string;
  subject: string;
  predicate: string;
  object: string;
  createdAt: Date;
  validAt: Date;
  content?: string; // For implicit pattern analysis
}

interface SpaceThemeData {
  themes: string[];
  summary: string;
}

// Zod schemas for LLM response validation
const ExplicitPatternSchema = z.object({
  name: z.string(),
  type: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const ImplicitPatternSchema = z.object({
  name: z.string(),
  type: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const PatternAnalysisSchema = z.object({
  explicitPatterns: z.array(ExplicitPatternSchema),
  implicitPatterns: z.array(ImplicitPatternSchema),
});

const CONFIG = {
  minStatementsForPatterns: 5,
  maxPatternsPerSpace: 20,
  minPatternConfidence: 0.85,
};

export const spacePatternTask = task({
  id: "space-pattern",
  run: async (payload: SpacePatternPayload) => {
    const { userId, workspaceId, spaceId, triggerSource = "manual" } = payload;

    logger.info(`Starting space pattern detection`, {
      userId,
      workspaceId,
      spaceId,
      triggerSource,
    });

    try {
      // Get space data and check if it has enough content
      const space = await getSpaceForPatternAnalysis(spaceId, userId);
      if (!space) {
        return {
          success: false,
          spaceId,
          error: "Space not found or insufficient data",
        };
      }

      // Get statements for pattern analysis
      const statements = await getSpaceStatementsForPatterns(spaceId, userId);

      if (statements.length < CONFIG.minStatementsForPatterns) {
        logger.info(
          `Space ${spaceId} has insufficient statements (${statements.length}) for pattern detection`,
        );
        return {
          success: true,
          spaceId,
          triggerSource,
          patterns: {
            explicitPatterns: [],
            implicitPatterns: [],
            totalPatternsFound: 0,
          },
        };
      }

      // Detect patterns
      const patternResult = await detectSpacePatterns(space, statements);

      if (patternResult) {
        // Store patterns
        await storePatterns(
          patternResult.explicitPatterns,
          patternResult.implicitPatterns,
          spaceId,
        );

        logger.info(`Generated patterns for space ${spaceId}`, {
          explicitPatterns: patternResult.explicitPatterns.length,
          implicitPatterns: patternResult.implicitPatterns.length,
          totalPatterns: patternResult.totalPatternsFound,
          triggerSource,
        });

        return {
          success: true,
          spaceId,
          triggerSource,
          patterns: {
            explicitPatterns: patternResult.explicitPatterns.length,
            implicitPatterns: patternResult.implicitPatterns.length,
            totalPatternsFound: patternResult.totalPatternsFound,
          },
        };
      } else {
        logger.warn(`Failed to detect patterns for space ${spaceId}`);
        return {
          success: false,
          spaceId,
          triggerSource,
          error: "Failed to detect patterns",
        };
      }
    } catch (error) {
      logger.error(
        `Error in space pattern detection for space ${spaceId}:`,
        error as Record<string, unknown>,
      );
      throw error;
    }
  },
});

async function getSpaceForPatternAnalysis(
  spaceId: string,
  userId: string,
): Promise<SpaceThemeData | null> {
  try {
    const space = await prisma.space.findFirst({
      where: {
        id: spaceId,
        workspace: {
          userId: userId,
        },
      },
    });

    if (!space || !space.themes || space.themes.length === 0) {
      logger.warn(
        `Space ${spaceId} not found or has no themes for pattern analysis`,
      );
      return null;
    }

    return {
      themes: space.themes,
      summary: space.summary || "",
    };
  } catch (error) {
    logger.error(
      `Error getting space for pattern analysis:`,
      error as Record<string, unknown>,
    );
    return null;
  }
}

async function getSpaceStatementsForPatterns(
  spaceId: string,
  userId: string,
): Promise<SpaceStatementData[]> {
  const query = `
    MATCH (s:Statement)
    WHERE s.userId = $userId 
      AND s.spaceIds IS NOT NULL 
      AND $spaceId IN s.spaceIds 
      AND s.invalidAt IS NULL
    MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
    MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
    MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
    RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
    ORDER BY s.createdAt DESC
  `;

  const result = await runQuery(query, {
    spaceId,
    userId,
  });

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
      content: statement.fact, // Use fact as content for implicit analysis
    };
  });
}

async function detectSpacePatterns(
  space: SpaceThemeData,
  statements: SpaceStatementData[],
): Promise<PatternDetectionResult | null> {
  try {
    // Extract explicit patterns from themes
    const explicitPatterns = await extractExplicitPatterns(
      space.themes,
      space.summary,
      statements,
    );

    // Extract implicit patterns from statement analysis
    const implicitPatterns = await extractImplicitPatterns(statements);

    return {
      explicitPatterns,
      implicitPatterns,
      totalPatternsFound: explicitPatterns.length + implicitPatterns.length,
      processingStats: {
        statementsAnalyzed: statements.length,
        themesProcessed: space.themes.length,
        implicitPatternsExtracted: implicitPatterns.length,
      },
    };
  } catch (error) {
    logger.error(
      "Error detecting space patterns:",
      error as Record<string, unknown>,
    );
    return null;
  }
}

async function extractExplicitPatterns(
  themes: string[],
  summary: string,
  statements: SpaceStatementData[],
): Promise<Omit<SpacePattern, "id" | "createdAt" | "updatedAt" | "spaceId">[]> {
  if (themes.length === 0) return [];

  const prompt = createExplicitPatternPrompt(themes, summary, statements);

  let responseText = "";
  await makeModelCall(false, prompt, (text: string) => {
    responseText = text;
  });

  const patterns = parseExplicitPatternResponse(responseText);

  return patterns.map((pattern) => ({
    name: pattern.name || `${pattern.type} pattern`,
    source: "explicit" as const,
    type: pattern.type,
    summary: pattern.summary,
    evidence: pattern.evidence,
    confidence: pattern.confidence,
    userConfirmed: "pending" as const,
  }));
}

async function extractImplicitPatterns(
  statements: SpaceStatementData[],
): Promise<Omit<SpacePattern, "id" | "createdAt" | "updatedAt" | "spaceId">[]> {
  if (statements.length < CONFIG.minStatementsForPatterns) return [];

  const prompt = createImplicitPatternPrompt(statements);

  let responseText = "";
  await makeModelCall(false, prompt, (text: string) => {
    responseText = text;
  });

  const patterns = parseImplicitPatternResponse(responseText);

  return patterns.map((pattern) => ({
    name: pattern.name || `${pattern.type} pattern`,
    source: "implicit" as const,
    type: pattern.type,
    summary: pattern.summary,
    evidence: pattern.evidence,
    confidence: pattern.confidence,
    userConfirmed: "pending" as const,
  }));
}

function createExplicitPatternPrompt(
  themes: string[],
  summary: string,
  statements: SpaceStatementData[],
): CoreMessage[] {
  const statementsText = statements
    .map((stmt) => `[${stmt.uuid}] ${stmt.fact}`)
    .join("\n");

  const explicitTypes = Object.values(EXPLICIT_PATTERN_TYPES).join('", "');

  return [
    {
      role: "system",
      content: `You are an expert at extracting structured patterns from themes and supporting evidence. 

Your task is to convert high-level themes into explicit patterns with supporting statement evidence.

INSTRUCTIONS:
1. For each theme, create a pattern that explains what it reveals about the user
2. Give each pattern a short, descriptive name (2-4 words)
3. Find supporting statement IDs that provide evidence for each pattern
4. Assess confidence based on evidence strength and theme clarity
5. Use appropriate pattern types from these guidelines: "${explicitTypes}"
   - "theme": High-level thematic content areas
   - "topic": Specific subject matter or topics of interest
   - "domain": Knowledge or work domains the user operates in
   - "interest_area": Areas of personal interest or hobby
6. You may suggest new pattern types if none of the guidelines fit well

RESPONSE FORMAT:
Provide your response inside <output></output> tags with valid JSON.

<output>
{
  "explicitPatterns": [
    {
      "name": "Short descriptive name for the pattern",
      "type": "theme",
      "summary": "Description of what this pattern reveals about the user",
      "evidence": ["statement_id_1", "statement_id_2"],
      "confidence": 0.85
    }
  ]
}
</output>`,
    },
    {
      role: "user",
      content: `THEMES TO ANALYZE:
${themes.map((theme, i) => `${i + 1}. ${theme}`).join("\n")}

SPACE SUMMARY:
${summary}

SUPPORTING STATEMENTS:
${statementsText}

Please extract explicit patterns from these themes and map them to supporting statement evidence.`,
    },
  ];
}

function createImplicitPatternPrompt(
  statements: SpaceStatementData[],
): CoreMessage[] {
  const statementsText = statements
    .map(
      (stmt) =>
        `[${stmt.uuid}] ${stmt.fact} (${stmt.subject} → ${stmt.predicate} → ${stmt.object})`,
    )
    .join("\n");

  const implicitTypes = Object.values(IMPLICIT_PATTERN_TYPES).join('", "');

  return [
    {
      role: "system",
      content: `You are an expert at discovering implicit behavioral patterns from statement analysis.

Your task is to identify hidden patterns in user behavior, preferences, and habits from statement content.

INSTRUCTIONS:
1. Analyze statement content for behavioral patterns, not explicit topics
2. Give each pattern a short, descriptive name (2-4 words)
3. Look for recurring behaviors, preferences, and working styles
4. Identify how the user approaches tasks, makes decisions, and interacts
5. Use appropriate pattern types from these guidelines: "${implicitTypes}"
   - "preference": Personal preferences and choices
   - "habit": Recurring behaviors and routines
   - "workflow": Work and process patterns
   - "communication_style": How user communicates and expresses ideas
   - "decision_pattern": Decision-making approaches and criteria
   - "temporal_pattern": Time-based behavioral patterns
   - "behavioral_pattern": General behavioral tendencies
   - "learning_style": How user learns and processes information
   - "collaboration_style": How user works with others
6. You may suggest new pattern types if none of the guidelines fit well
7. Focus on what the statements reveal about how the user thinks, works, or behaves

RESPONSE FORMAT:
Provide your response inside <output></output> tags with valid JSON.

<output>
{
  "implicitPatterns": [
    {
      "name": "Short descriptive name for the pattern",
      "type": "preference",
      "summary": "Description of what this behavioral pattern reveals",
      "evidence": ["statement_id_1", "statement_id_2"],
      "confidence": 0.75
    }
  ]
}
</output>`,
    },
    {
      role: "user",
      content: `STATEMENTS TO ANALYZE FOR IMPLICIT PATTERNS:
${statementsText}

Please identify implicit behavioral patterns, preferences, and habits from these statements.`,
    },
  ];
}

function parseExplicitPatternResponse(response: string): Array<{
  name: string;
  type: string;
  summary: string;
  evidence: string[];
  confidence: number;
}> {
  try {
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn("No <output> tags found in explicit pattern response");
      return [];
    }

    const parsed = JSON.parse(outputMatch[1].trim());
    const validationResult = z
      .object({
        explicitPatterns: z.array(ExplicitPatternSchema),
      })
      .safeParse(parsed);

    if (!validationResult.success) {
      logger.warn("Invalid explicit pattern response format:", {
        error: validationResult.error,
      });
      return [];
    }

    return validationResult.data.explicitPatterns.filter(
      (p) =>
        p.confidence >= CONFIG.minPatternConfidence && p.evidence.length >= 3, // Ensure at least 3 evidence statements
    );
  } catch (error) {
    logger.error(
      "Error parsing explicit pattern response:",
      error as Record<string, unknown>,
    );
    return [];
  }
}

function parseImplicitPatternResponse(response: string): Array<{
  name: string;
  type: string;
  summary: string;
  evidence: string[];
  confidence: number;
}> {
  try {
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn("No <output> tags found in implicit pattern response");
      return [];
    }

    const parsed = JSON.parse(outputMatch[1].trim());
    const validationResult = z
      .object({
        implicitPatterns: z.array(ImplicitPatternSchema),
      })
      .safeParse(parsed);

    if (!validationResult.success) {
      logger.warn("Invalid implicit pattern response format:", {
        error: validationResult.error,
      });
      return [];
    }

    return validationResult.data.implicitPatterns.filter(
      (p) =>
        p.confidence >= CONFIG.minPatternConfidence && p.evidence.length >= 3, // Ensure at least 3 evidence statements
    );
  } catch (error) {
    logger.error(
      "Error parsing implicit pattern response:",
      error as Record<string, unknown>,
    );
    return [];
  }
}

async function storePatterns(
  explicitPatterns: Omit<
    SpacePattern,
    "id" | "createdAt" | "updatedAt" | "spaceId"
  >[],
  implicitPatterns: Omit<
    SpacePattern,
    "id" | "createdAt" | "updatedAt" | "spaceId"
  >[],
  spaceId: string,
): Promise<void> {
  try {
    const allPatterns = [...explicitPatterns, ...implicitPatterns];

    if (allPatterns.length === 0) return;

    // Store in PostgreSQL
    await prisma.spacePattern.createMany({
      data: allPatterns.map((pattern) => ({
        ...pattern,
        spaceId,
        userConfirmed: pattern.userConfirmed as any, // Temporary cast until Prisma client is regenerated
      })),
    });

    logger.info(`Stored ${allPatterns.length} patterns`, {
      explicit: explicitPatterns.length,
      implicit: implicitPatterns.length,
    });
  } catch (error) {
    logger.error("Error storing patterns:", error as Record<string, unknown>);
    throw error;
  }
}

// Helper function to trigger the task
export async function triggerSpacePattern(payload: SpacePatternPayload) {
  return await spacePatternTask.trigger(payload, {
    concurrencyKey: `space-pattern-${payload.spaceId}`, // Prevent parallel runs for the same space
    tags: [payload.userId, payload.spaceId, payload.triggerSource || "manual"],
  });
}

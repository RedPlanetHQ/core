import { task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";
import { makeModelCall } from "~/lib/model.server";
import { createBatch, getBatch } from "~/lib/batch.server";
import { runQuery } from "~/lib/neo4j.server";
import {
  assignStatementsToSpace,
  shouldTriggerSpacePattern,
  atomicUpdatePatternTrigger,
  getSpaceStatementCount,
} from "~/services/graphModels/space";
import { triggerSpaceSummary } from "./space-summary";
import { triggerSpacePattern } from "./space-pattern";
import { updateMultipleSpaceStatuses, SPACE_STATUS } from "../utils/space-status";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { type Space } from "@prisma/client";

interface SpaceAssignmentPayload {
  userId: string;
  workspaceId: string;
  mode: "new_space" | "episode";
  newSpaceId?: string; // For new_space mode
  episodeId?: string; // For daily_batch mode (default: 1)
  batchSize?: number; // Processing batch size
}

interface StatementData {
  uuid: string;
  fact: string;
  subject: string;
  predicate: string;
  object: string;
  createdAt: Date;
  spaceIds: string[];
}

interface SpaceData {
  uuid: string;
  name: string;
  description?: string;
  statementCount: number;
}

interface AssignmentResult {
  statementId: string;
  spaceIds: string[];
  confidence: number;
  reasoning?: string;
}

const CONFIG = {
  newSpaceMode: {
    batchSize: 200,
    confidenceThreshold: 0.85, // High quality threshold for new space creation
    useBatchAPI: true, // Use batch API for new space mode
    minStatementsForBatch: 10, // Minimum statements to use batch API
  },
  episodeMode: {
    batchSize: 200,
    confidenceThreshold: 0.85, // Strict threshold for theme validation (5+ statements)
    useBatchAPI: true, // Use batch API for episode mode
    minStatementsForBatch: 5, // Minimum statements to use batch API
  },
};

// Zod schema for LLM response validation
const AssignmentResultSchema = z.array(
  z.object({
    statementId: z.string(),
    addSpaceId: z.array(z.string()),
    confidence: z.number(),
  }),
);

/**
 * Check and trigger space patterns for spaces that meet growth thresholds
 */
async function checkAndTriggerSpacePatterns(
  affectedSpaces: Set<string>,
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (affectedSpaces.size === 0) return;

  logger.info(
    `Checking pattern triggers for ${affectedSpaces.size} affected spaces`,
    {
      userId,
      spaceIds: Array.from(affectedSpaces),
    },
  );

  const patternPromises = Array.from(affectedSpaces).map(async (spaceId) => {
    try {
      // Check if this space should trigger pattern analysis
      const triggerCheck = await shouldTriggerSpacePattern(spaceId, userId);

      if (triggerCheck.shouldTrigger) {
        // Atomically update the trigger timestamp to prevent race conditions
        const updateResult = await atomicUpdatePatternTrigger(
          spaceId,
          triggerCheck.currentCount,
        );

        if (updateResult?.updated) {
          const triggerSource = updateResult.isNewSpace
            ? "new_space"
            : "growth_threshold";

          logger.info(`Triggering space pattern analysis`, {
            spaceId,
            triggerSource,
            currentCount: triggerCheck.currentCount,
            isNewSpace: updateResult.isNewSpace,
          });

          await triggerSpacePattern({
            userId,
            workspaceId,
            spaceId,
            triggerSource: triggerSource as "new_space" | "growth_threshold",
          });

          return { success: true, spaceId, triggerSource };
        } else {
          logger.info(`Pattern trigger update failed or no longer needed`, {
            spaceId,
            triggerCheck,
          });
          return { success: false, spaceId, reason: "update_failed" };
        }
      } else {
        logger.info(`Space does not meet pattern trigger criteria`, {
          spaceId,
          currentCount: triggerCheck.currentCount,
          isNewSpace: triggerCheck.isNewSpace,
        });
        return { success: false, spaceId, reason: "threshold_not_met" };
      }
    } catch (error) {
      logger.error(`Error checking pattern trigger for space ${spaceId}:`, {
        error,
        userId,
      });
      return {
        success: false,
        spaceId,
        error: error instanceof Error ? error.message : "unknown_error",
      };
    }
  });

  const results = await Promise.allSettled(patternPromises);
  const successful = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = results.filter(
    (r) =>
      r.status === "rejected" || (r.status === "fulfilled" && !r.value.success),
  ).length;

  logger.info(`Pattern trigger check completed`, {
    userId,
    totalSpaces: affectedSpaces.size,
    successful,
    failed,
  });
}

export const spaceAssignmentTask = task({
  id: "space-assignment",
  run: async (payload: SpaceAssignmentPayload) => {
    const {
      userId,
      workspaceId,
      mode,
      newSpaceId,
      episodeId,
      batchSize = mode === "new_space"
        ? CONFIG.newSpaceMode.batchSize
        : CONFIG.episodeMode.batchSize,
    } = payload;

    logger.info(`Starting space assignment`, {
      userId,
      mode,
      newSpaceId,
      episodeId,
      batchSize,
    });

    const spaceService = new SpaceService();

    try {
      // 1. Get user's spaces
      const spaces = await spaceService.getUserSpaces(userId);

      if (spaces.length === 0) {
        logger.info(`No spaces found for user ${userId}, skipping assignment`);
        return {
          success: true,
          message: "No spaces to assign to",
          processed: 0,
        };
      }

      // 2. Get statements to analyze based on mode
      const statements = await getStatementsToAnalyze(userId, mode, {
        newSpaceId,
        episodeId,
      });

      if (statements.length === 0) {
        logger.info(
          `No statements to analyze for user ${userId} in ${mode} mode`,
        );
        return {
          success: true,
          message: "No statements to analyze",
          processed: 0,
        };
      }

      // 3. Process statements using batch AI or fallback to sequential
      const config =
        mode === "new_space" ? CONFIG.newSpaceMode : CONFIG.episodeMode;
      // const shouldUseBatchAPI =
      // config.useBatchAPI && statements.length >= config.minStatementsForBatch;
      const shouldUseBatchAPI = true;

      let totalProcessed = 0;
      let totalAssignments = 0;
      let totalBatches = 0;
      const affectedSpaces = new Set<string>(); // Track spaces that received new statements

      if (shouldUseBatchAPI) {
        logger.info(
          `Using Batch AI processing for ${statements.length} statements`,
          {
            mode,
            userId,
            batchSize,
          },
        );

        const batchResult = await processBatchAI(
          statements,
          spaces,
          userId,
          mode,
          newSpaceId,
          batchSize,
        );
        totalProcessed = batchResult.processed;
        totalAssignments = batchResult.assignments;
        batchResult.affectedSpaces?.forEach((spaceId) =>
          affectedSpaces.add(spaceId),
        );
      } else {
        logger.info(
          `Using sequential processing for ${statements.length} statements (below batch threshold)`,
          {
            mode,
            userId,
            minRequired: config.minStatementsForBatch,
          },
        );

        // Fallback to sequential processing for smaller statement sets
        totalBatches = Math.ceil(statements.length / batchSize);

        for (let i = 0; i < totalBatches; i++) {
          const batch = statements.slice(i * batchSize, (i + 1) * batchSize);

          logger.info(
            `Processing batch ${i + 1}/${totalBatches} with ${batch.length} statements`,
            {
              mode,
              userId,
            },
          );

          const batchResult = await processBatch(
            batch,
            spaces,
            userId,
            mode,
            newSpaceId,
          );
          totalProcessed += batchResult.processed;
          totalAssignments += batchResult.assignments;
          batchResult.affectedSpaces?.forEach((spaceId) =>
            affectedSpaces.add(spaceId),
          );

          // Add delay between batches to avoid rate limiting
          if (i < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      logger.info(`Completed LLM space assignment`, {
        userId,
        mode,
        totalProcessed,
        totalAssignments,
        spacesAvailable: spaces.length,
        affectedSpaces: affectedSpaces.size,
      });

      // 4. Update space status to "processing" for affected spaces
      if (affectedSpaces.size > 0) {
        try {
          await updateMultipleSpaceStatuses(
            Array.from(affectedSpaces),
            SPACE_STATUS.PROCESSING,
            {
              userId,
              operation: "space-assignment",
              metadata: { mode, phase: "start_processing" },
            }
          );
        } catch (statusError) {
          logger.warn(`Failed to update space statuses to processing:`, {
            error: statusError,
            userId,
            mode,
          });
        }
      }

      // 5. Trigger space summaries for affected spaces (fan-out pattern)  
      if (affectedSpaces.size > 0) {
        try {
          logger.info(
            `Triggering space summaries for ${affectedSpaces.size} affected spaces in parallel`,
          );

          // Fan out to multiple parallel triggers
          const summaryPromises = Array.from(affectedSpaces).map((spaceId) =>
            triggerSpaceSummary({
              userId,
              workspaceId,
              spaceId,
              triggerSource: "assignment",
            }).catch((error) => {
              logger.warn(`Failed to trigger summary for space ${spaceId}:`, {
                error,
              });
              return { success: false, spaceId, error: error.message };
            }),
          );

          const summaryResults = await Promise.allSettled(summaryPromises);
          const successful = summaryResults.filter(
            (r) => r.status === "fulfilled",
          ).length;
          const failed = summaryResults.filter(
            (r) => r.status === "rejected",
          ).length;

          logger.info(`Space summary triggers completed`, {
            userId,
            mode,
            totalSpaces: affectedSpaces.size,
            successful,
            failed,
          });
        } catch (summaryError) {
          // Don't fail the assignment if summary generation fails
          logger.warn(`Failed to trigger space summaries after assignment:`, {
            error: summaryError,
            userId,
            mode,
            affectedSpaces: Array.from(affectedSpaces),
          });
        }
      }

      // 5. Check and trigger space patterns for qualifying spaces (new spaces or 100+ growth)
      if (affectedSpaces.size > 0) {
        try {
          logger.info(`Checking pattern triggers for affected spaces`, {
            userId,
            mode,
            affectedSpacesCount: affectedSpaces.size,
          });

          await checkAndTriggerSpacePatterns(
            affectedSpaces,
            userId,
            workspaceId,
          );
        } catch (patternError) {
          // Don't fail the assignment if pattern triggering fails
          logger.warn(`Failed to trigger space patterns after assignment:`, {
            error: patternError,
            userId,
            mode,
            affectedSpaces: Array.from(affectedSpaces),
          });
        }
      }

      // 7. Update space status to "ready" after all processing is complete
      if (affectedSpaces.size > 0) {
        try {
          await updateMultipleSpaceStatuses(
            Array.from(affectedSpaces),
            SPACE_STATUS.READY,
            {
              userId,
              operation: "space-assignment",
              metadata: { mode, phase: "completed_processing" },
            }
          );
        } catch (finalStatusError) {
          logger.warn(`Failed to update space statuses to ready:`, {
            error: finalStatusError,
            userId,
            mode,
          });
        }
      }

      return {
        success: true,
        mode,
        processed: totalProcessed,
        assignments: totalAssignments,
        batches: totalBatches,
        spacesAvailable: spaces.length,
        affectedSpaces: affectedSpaces.size,
        summaryTriggered: affectedSpaces.size > 0,
        patternCheckTriggered: affectedSpaces.size > 0,
      };
    } catch (error) {
      logger.error(
        `Error in LLM space assignment for user ${userId}:`,
        error as Record<string, unknown>,
      );
      throw error;
    }
  },
});

async function getStatementsToAnalyze(
  userId: string,
  mode: "new_space" | "episode",
  options: { newSpaceId?: string; episodeId?: string },
): Promise<StatementData[]> {
  let query: string;
  let params: any = { userId };

  if (mode === "new_space") {
    // For new space: analyze all statements (or recent ones)
    query = `
      MATCH (s:Statement)
      WHERE s.userId = $userId AND s.invalidAt IS NULL
      MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
      MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
      MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
      RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
      ORDER BY s.createdAt DESC
    `;
  } else {
    query = `
      MATCH (s:Statement)
      WHERE s.userId = $userId 
        AND s.invalidAt IS NULL
        AND s.episodeUuid = $episodeId
      MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
      MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
      MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
      RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
      ORDER BY s.createdAt DESC
    `;
    params.episodeId = options.episodeId;
  }

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
      spaceIds: statement.spaceIds || [],
    };
  });
}

async function processBatchAI(
  statements: StatementData[],
  spaces: Space[],
  userId: string,
  mode: "new_space" | "episode",
  newSpaceId?: string,
  batchSize: number = 50,
): Promise<{
  processed: number;
  assignments: number;
  affectedSpaces?: string[];
}> {
  try {
    // Create batches of statements
    const statementBatches: StatementData[][] = [];
    for (let i = 0; i < statements.length; i += batchSize) {
      statementBatches.push(statements.slice(i, i + batchSize));
    }

    logger.info(
      `Creating ${statementBatches.length} batch AI requests for ${statements.length} statements`,
    );

    // Create batch requests with prompts
    const batchRequests = await Promise.all(
      statementBatches.map(async (batch, index) => {
        const promptMessages = await createLLMPrompt(
          batch,
          spaces,
          mode,
          newSpaceId,
          userId,
        );
        const systemPrompt =
          promptMessages.find((m) => m.role === "system")?.content || "";
        const userPrompt =
          promptMessages.find((m) => m.role === "user")?.content || "";

        return {
          customId: `space-assignment-${userId}-${mode}-${index}`,
          messages: [{ role: "user" as const, content: userPrompt }],
          systemPrompt,
        };
      }),
    );

    // Submit batch to AI provider
    const { batchId } = await createBatch({
      requests: batchRequests,
      outputSchema: AssignmentResultSchema,
      maxRetries: 3,
      timeoutMs: 600000, // 10 minutes timeout
    });
    logger.info(`Batch AI job created: ${batchId}`, {
      userId,
      mode,
      batchRequests: batchRequests.length,
    });

    // Poll for completion with improved handling
    const maxPollingTime = 600000; // 10 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();

    let batch = await getBatch({ batchId });

    while (batch.status === "processing" || batch.status === "pending") {
      const elapsed = Date.now() - startTime;

      if (elapsed > maxPollingTime) {
        logger.warn(
          `Batch AI job timed out after ${elapsed}ms, processing partial results`,
          {
            batchId,
            status: batch.status,
            completed: batch.completedRequests,
            total: batch.totalRequests,
            failed: batch.failedRequests,
          },
        );
        break; // Exit loop to process any available results
      }

      logger.info(`Batch AI job status: ${batch.status}`, {
        batchId,
        completed: batch.completedRequests,
        total: batch.totalRequests,
        failed: batch.failedRequests,
        elapsed: elapsed,
      });

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      batch = await getBatch({ batchId });
    }

    // Handle different completion scenarios
    if (batch.status === "failed") {
      logger.error(`Batch AI job failed completely`, {
        batchId,
        status: batch.status,
      });
      throw new Error(`Batch AI job failed with status: ${batch.status}`);
    }

    // Log final status regardless of completion state
    logger.info(`Batch AI job processing finished`, {
      batchId,
      status: batch.status,
      completed: batch.completedRequests,
      total: batch.totalRequests,
      failed: batch.failedRequests,
    });

    if (!batch.results || batch.results.length === 0) {
      logger.warn(`No results returned from batch AI job ${batchId}`, {
        status: batch.status,
        completed: batch.completedRequests,
        failed: batch.failedRequests,
      });

      // If we have no results but some requests failed, fall back to sequential processing
      if (batch.failedRequests && batch.failedRequests > 0) {
        logger.info(
          `Falling back to sequential processing due to batch failures`,
        );
        return await processBatch(statements, spaces, userId, mode, newSpaceId);
      }

      return { processed: statements.length, assignments: 0 };
    }

    logger.info(`Processing batch results`, {
      batchId,
      status: batch.status,
      resultsCount: batch.results.length,
      totalRequests: batch.totalRequests,
      completedRequests: batch.completedRequests,
      failedRequests: batch.failedRequests,
    });

    // Process all batch results
    let totalAssignments = 0;
    const affectedSpaces = new Set<string>();
    const confidenceThreshold =
      mode === "new_space"
        ? CONFIG.newSpaceMode.confidenceThreshold
        : CONFIG.episodeMode.confidenceThreshold;

    for (const result of batch.results) {
      if (result.error) {
        logger.warn(`Batch AI request ${result.customId} failed:`, {
          error: result.error,
        });
        continue;
      }

      if (!result.response) {
        logger.warn(`No response from batch AI request ${result.customId}`);
        continue;
      }

      // Parse assignments from this batch result
      let assignments: AssignmentResult[] = [];
      try {
        // Extract statement batch info from customId
        const [, , , batchIndex] = result.customId.split("-");
        const statementBatch = statementBatches[parseInt(batchIndex)];

        if (Array.isArray(result.response)) {
          // Handle direct array response (from structured output)
          assignments = result.response.map((a) => ({
            statementId: a.statementId,
            spaceIds: a.addSpaceId || [],
            confidence: a.confidence || 0.8,
          }));
        } else if (typeof result.response === "string") {
          // Parse from text response with <output> tags (fallback for non-structured output)
          assignments = parseLLMResponseWithTags(
            result.response,
            statementBatch,
            spaces,
          );
        } else if (typeof result.response === "object" && result.response) {
          // Handle object response that might contain the array directly
          try {
            let responseData = result.response;
            if (responseData.results && Array.isArray(responseData.results)) {
              responseData = responseData.results;
            }

            if (Array.isArray(responseData)) {
              assignments = responseData.map((a) => ({
                statementId: a.statementId,
                spaceIds: a.addSpaceId || [],
                confidence: a.confidence || 0.8,
              }));
            } else {
              // Fallback parsing
              assignments = parseLLMResponse(
                JSON.stringify(result.response),
                statementBatch,
                spaces,
              );
            }
          } catch (parseError) {
            logger.error(
              `Error processing object response ${result.customId}:`,
              { error: parseError },
            );
            assignments = [];
          }
        } else {
          // Fallback parsing
          assignments = parseLLMResponse(
            JSON.stringify(result.response),
            statementBatch,
            spaces,
          );
        }
      } catch (parseError) {
        logger.error(`Error parsing batch result ${result.customId}:`, {
          error: parseError,
        });
        continue;
      }

      // Group statements by space for batch assignment
      const spaceToStatements = new Map<string, string[]>();

      for (const assignment of assignments) {
        if (
          assignment.spaceIds.length > 0 &&
          assignment.confidence >= confidenceThreshold
        ) {
          for (const spaceId of assignment.spaceIds) {
            if (!spaceToStatements.has(spaceId)) {
              spaceToStatements.set(spaceId, []);
            }
            spaceToStatements.get(spaceId)!.push(assignment.statementId);
          }
        }
      }

      // Apply batch assignments - one call per space
      for (const [spaceId, statementIds] of spaceToStatements) {
        try {
          const assignmentResult = await assignStatementsToSpace(
            statementIds,
            spaceId,
            userId,
          );

          if (assignmentResult.success) {
            totalAssignments += statementIds.length;
            affectedSpaces.add(spaceId);
            logger.info(
              `Batch AI assigned ${statementIds.length} statements to space ${spaceId}`,
              {
                statementIds,
                mode,
                batchId: result.customId,
              },
            );
          }
        } catch (error) {
          logger.warn(
            `Failed to assign ${statementIds.length} statements to space ${spaceId}:`,
            { error, statementIds },
          );
        }
      }
    }

    // Log final batch processing results
    logger.info(`Batch AI processing completed`, {
      batchId,
      totalStatements: statements.length,
      processedBatches: batch.results.length,
      totalAssignments,
      affectedSpaces: affectedSpaces.size,
      completedRequests: batch.completedRequests,
      failedRequests: batch.failedRequests || 0,
    });

    // If we have significant failures, consider fallback processing for remaining statements
    const failureRate = batch.failedRequests
      ? batch.failedRequests / batch.totalRequests
      : 0;
    if (failureRate > 0.5) {
      // If more than 50% failed
      logger.warn(
        `High failure rate (${Math.round(failureRate * 100)}%) in batch processing, consider reviewing prompts or input quality`,
      );
    }

    return {
      processed: statements.length,
      assignments: totalAssignments,
      affectedSpaces: Array.from(affectedSpaces),
    };
  } catch (error) {
    logger.error("Error in Batch AI processing:", { error });
    throw error;
  }
}

async function processBatch(
  statements: StatementData[],
  spaces: Space[],
  userId: string,
  mode: "new_space" | "episode",
  newSpaceId?: string,
): Promise<{
  processed: number;
  assignments: number;
  affectedSpaces?: string[];
}> {
  try {
    // Create the LLM prompt based on mode
    const prompt = await createLLMPrompt(
      statements,
      spaces,
      mode,
      newSpaceId,
      userId,
    );

    // Call LLM for space assignments
    let responseText = "";
    await makeModelCall(false, prompt, (text: string) => {
      responseText = text;
    });

    // Response text is now set by the callback

    // Parse LLM response
    const assignments = parseLLMResponseWithTags(
      responseText,
      statements,
      spaces,
    );

    // Apply assignments
    let totalAssignments = 0;
    const affectedSpaces = new Set<string>();
    const confidenceThreshold =
      mode === "new_space"
        ? CONFIG.newSpaceMode.confidenceThreshold
        : CONFIG.episodeMode.confidenceThreshold;

    for (const assignment of assignments) {
      if (
        assignment.spaceIds.length > 0 &&
        assignment.confidence >= confidenceThreshold
      ) {
        // Assign to each space individually to track metadata properly
        for (const spaceId of assignment.spaceIds) {
          try {
            const result = await assignStatementsToSpace(
              [assignment.statementId],
              spaceId,
              userId,
            );

            if (result.success) {
              totalAssignments++;
              affectedSpaces.add(spaceId);

              logger.info(
                `LLM assigned statement ${assignment.statementId} to space ${spaceId}`,
                {
                  confidence: assignment.confidence,
                  reasoning: assignment.reasoning || "No reasoning",
                  mode,
                } as Record<string, unknown>,
              );
            }
          } catch (error) {
            logger.warn(
              `Failed to assign statement ${assignment.statementId} to space ${spaceId}:`,
              error as Record<string, unknown>,
            );
          }
        }
      }
    }

    return {
      processed: statements.length,
      assignments: totalAssignments,
      affectedSpaces: Array.from(affectedSpaces),
    };
  } catch (error) {
    logger.error("Error processing batch:", error as Record<string, unknown>);
    return { processed: 0, assignments: 0, affectedSpaces: [] };
  }
}

async function createLLMPrompt(
  statements: StatementData[],
  spaces: Space[],
  mode: "new_space" | "episode",
  newSpaceId?: string,
  userId?: string,
): Promise<CoreMessage[]> {
  const statementsDescription = statements
    .map(
      (stmt) =>
        `ID: ${stmt.uuid}\nFACT: ${stmt.fact}\nCURRENT_SPACES: [${stmt.spaceIds.join(", ")}]`,
    )
    .join("\n\n");

  // Get enhanced space information with statement counts
  const enhancedSpaces = await Promise.all(
    spaces.map(async (space) => {
      const currentCount = userId
        ? await getSpaceStatementCount(space.id, userId)
        : 0;
      return {
        ...space,
        currentStatementCount: currentCount,
      };
    }),
  );

  if (mode === "new_space" && newSpaceId) {
    // Focus on the new space for assignment
    const newSpace = enhancedSpaces.find((s) => s.id === newSpaceId);
    if (!newSpace) {
      throw new Error(`New space ${newSpaceId} not found`);
    }

    return [
      {
        role: "system",
        content: `You are analyzing statements for assignment to a newly created space. Focus on semantic relevance to this specific space.

INSTRUCTIONS:
1. Analyze each statement's meaning in relation to the new space
2. Only assign statements that are genuinely relevant (confidence >= 0.85)
3. Consider semantic meaning, context, and conceptual fit
4. Be selective - it's better to miss some than include irrelevant ones
5. If a statement doesn't fit the space well, use empty addSpaceId: []

RESPONSE FORMAT:
Provide your response inside <output></output> tags with a valid JSON array:

<output>
[
  {
    "statementId": "statement-uuid",
    "addSpaceId": ["${newSpaceId}"],
    "confidence": 0.85,
  }
]
</output>

IMPORTANT: If a statement doesn't fit the space well, use empty addSpaceId array: []
Example of non-relevant statement: {"statementId": "stmt-123", "addSpaceId": [], "confidence": 0.0}`,
      },
      {
        role: "user",
        content: `NEW SPACE TO POPULATE:
Name: ${newSpace.name}
Description: ${newSpace.description || "No description"}
Current Statement Count: ${newSpace.currentStatementCount}
${newSpace.summary ? `Current Summary: ${newSpace.summary}` : ""}
${newSpace.themes && newSpace.themes.length > 0 ? `Existing Themes: ${newSpace.themes.join(", ")}` : ""}

STATEMENTS TO EVALUATE:
${statementsDescription}

Which statements are semantically relevant to "${newSpace.name}"? Focus on meaning and context.
Only assign statements with confidence >= 0.85.`,
      },
    ];
  } else {
    // Daily batch mode - consider all spaces
    const spacesDescription = enhancedSpaces
      .filter((space) => space.currentStatementCount >= 5) // Only include spaces with 5+ statements for theme validation
      .map((space) => {
        const spaceInfo = [
          `- ${space.name} (${space.id})`,
          `  Description: ${space.description || "No description"}`,
          `  Current Statements: ${space.currentStatementCount}`,
        ];

        if (space.summary) {
          spaceInfo.push(`  Summary: ${space.summary}`);
        }

        if (space.themes && space.themes.length > 0) {
          spaceInfo.push(`  Themes: ${space.themes.join(", ")}`);
        }

        return spaceInfo.join("\n");
      })
      .join("\n\n");

    return [
      {
        role: "system",
        content: `You are an expert at organizing information and assigning statements to relevant semantic spaces.

INSTRUCTIONS:
1. Analyze each statement's semantic meaning and context
2. Assign to the most appropriate space(s) - statements can belong to multiple spaces
3. Only assign if confidence >= 0.85 for quality
4. Consider relationships between subject, predicate, and object
5. Only assign to spaces with established themes (5+ statements)
6. If no spaces are relevant, use empty addSpaceId: []

RESPONSE FORMAT:
Provide your response inside <output></output> tags with a valid JSON array:

<output>
[
  {
    "statementId": "statement-uuid",
    "addSpaceId": ["space-uuid1", "space-uuid2"],
    "confidence": 0.85
  }
]
</output>

IMPORTANT: If no spaces are relevant, use empty addSpaceId array: []
Example of non-relevant statement: {"statementId": "stmt-123", "addSpaceId": [], "confidence": 0.0}`,
      },
      {
        role: "user",
        content: `AVAILABLE SPACES (with established themes - 5+ statements):
${spacesDescription}

STATEMENTS TO ORGANIZE:
${statementsDescription}

Assign each statement to the most semantically relevant space(s). Consider meaning over keywords.
Only assign to spaces with established themes (5+ statements) and with confidence >= 0.85.`,
      },
    ];
  }
}

function parseLLMResponseWithTags(
  response: string,
  statements: StatementData[],
  spaces: Space[],
): AssignmentResult[] {
  try {
    // Extract content from <output> tags
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn(
        "No <output> tags found in LLM response, falling back to full response parsing",
      );
      return parseLLMResponse(response, statements, spaces);
    }

    const jsonContent = outputMatch[1].trim();
    const parsed = JSON.parse(jsonContent);

    if (!Array.isArray(parsed)) {
      logger.warn(
        "Invalid LLM response format - expected array in <output> tags",
      );
      return [];
    }

    const validSpaceIds = new Set(spaces.map((s) => s.id));
    const validStatementIds = new Set(statements.map((s) => s.uuid));

    return parsed
      .filter((assignment: any) => {
        // Validate assignment structure
        if (
          !assignment.statementId ||
          !validStatementIds.has(assignment.statementId)
        ) {
          return false;
        }

        // Validate spaceIds array
        if (!assignment.addSpaceId || !Array.isArray(assignment.addSpaceId)) {
          assignment.addSpaceId = [];
        }

        // Filter out invalid space IDs
        assignment.addSpaceId = assignment.addSpaceId.filter(
          (spaceId: string) => validSpaceIds.has(spaceId),
        );

        return true;
      })
      .map((assignment: any) => ({
        statementId: assignment.statementId,
        spaceIds: assignment.addSpaceId,
        confidence: assignment.confidence || 0.8,
      }));
  } catch (error) {
    logger.error(
      "Error parsing LLM response with tags:",
      error as Record<string, unknown>,
    );
    logger.debug("Raw LLM response:", { response } as Record<string, unknown>);
    // Fallback to regular parsing
    return parseLLMResponse(response, statements, spaces);
  }
}

function parseLLMResponse(
  response: string,
  statements: StatementData[],
  spaces: Space[],
): AssignmentResult[] {
  try {
    // Clean the response - remove any markdown formatting
    const cleanedResponse = response
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleanedResponse);

    if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
      logger.warn("Invalid LLM response format - no assignments array");
      return [];
    }

    const validSpaceIds = new Set(spaces.map((s) => s.id));
    const validStatementIds = new Set(statements.map((s) => s.uuid));

    return parsed.assignments
      .filter((assignment: any) => {
        // Validate assignment structure
        if (
          !assignment.statementId ||
          !validStatementIds.has(assignment.statementId)
        ) {
          return false;
        }

        if (!assignment.spaceIds || !Array.isArray(assignment.spaceIds)) {
          return false;
        }

        // Filter out invalid space IDs
        assignment.spaceIds = assignment.spaceIds.filter((spaceId: string) =>
          validSpaceIds.has(spaceId),
        );

        return true;
      })
      .map((assignment: any) => ({
        statementId: assignment.statementId,
        spaceIds: assignment.spaceIds,
        confidence: assignment.confidence || 0.8,
      }));
  } catch (error) {
    logger.error(
      "Error parsing LLM response:",
      error as Record<string, unknown>,
    );
    logger.debug("Raw LLM response:", { response } as Record<string, unknown>);
    return [];
  }
}

// Helper function to trigger the task
export async function triggerSpaceAssignment(payload: SpaceAssignmentPayload) {
  return await spaceAssignmentTask.trigger(payload);
}

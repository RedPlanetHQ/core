import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";
import { makeModelCall } from "~/lib/model.server";
import { createBatch, getBatch } from "~/lib/batch.server";
import { runQuery } from "~/lib/neo4j.server";
import {
  assignEpisodesToSpace,
  getSpaceEpisodeCount,
} from "~/services/graphModels/space";
import { triggerSpaceSummary } from "./space-summary";
import { triggerSpacePattern } from "./space-pattern";
import {
  updateMultipleSpaceStatuses,
  SPACE_STATUS,
} from "../utils/space-status";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { type Space } from "@prisma/client";

export interface SpaceAssignmentPayload {
  userId: string;
  workspaceId: string;
  mode: "new_space" | "episode";
  newSpaceId?: string; // For new_space mode
  episodeIds?: string[]; // For daily_batch mode (default: 1)
  batchSize?: number; // Processing batch size
}

interface EpisodeData {
  uuid: string;
  content: string;
  originalContent: string;
  source: string;
  createdAt: Date;
  metadata: any;
}

interface SpaceData {
  uuid: string;
  name: string;
  description?: string;
  episodeCount: number;
}

interface AssignmentResult {
  episodeId: string;
  spaceIds: string[];
  confidence: number;
  reasoning?: string;
}

const CONFIG = {
  newSpaceMode: {
    batchSize: 20,
    confidenceThreshold: 0.75, // Intent-based threshold for new space creation
    useBatchAPI: true, // Use batch API for new space mode
    minEpisodesForBatch: 5, // Minimum episodes to use batch API
  },
  episodeMode: {
    batchSize: 20,
    confidenceThreshold: 0.75, // Intent-based threshold for episode assignment
    useBatchAPI: true, // Use batch API for episode mode
    minEpisodesForBatch: 5, // Minimum episodes to use batch API
  },
};

// Zod schema for LLM response validation
const AssignmentResultSchema = z.array(
  z.object({
    episodeId: z.string(),
    addSpaceId: z.array(z.string()),
    confidence: z.number(),
    reasoning: z.string(),
  }),
);

const spaceAssignmentQueue = queue({
  name: "space-assignment-queue",
  concurrencyLimit: 1,
});

export const spaceAssignmentTask = task({
  id: "space-assignment",
  queue: spaceAssignmentQueue,
  maxDuration: 1800, // 15 minutes timeout
  run: async (payload: SpaceAssignmentPayload) => {
    const {
      userId,
      workspaceId,
      mode,
      newSpaceId,
      episodeIds,
      batchSize = mode === "new_space"
        ? CONFIG.newSpaceMode.batchSize
        : CONFIG.episodeMode.batchSize,
    } = payload;

    logger.info(`Starting space assignment`, {
      userId,
      mode,
      newSpaceId,
      episodeIds,
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

      // 2. Get episodes to analyze based on mode
      const episodes = await getEpisodesToAnalyze(userId, mode, {
        newSpaceId,
        episodeIds,
      });

      if (episodes.length === 0) {
        logger.info(
          `No episodes to analyze for user ${userId} in ${mode} mode`,
        );
        return {
          success: true,
          message: "No episodes to analyze",
          processed: 0,
        };
      }

      // 3. Process episodes using batch AI or fallback to sequential
      const config =
        mode === "new_space" ? CONFIG.newSpaceMode : CONFIG.episodeMode;
      // const shouldUseBatchAPI =
      // config.useBatchAPI && episodes.length >= config.minEpisodesForBatch;
      const shouldUseBatchAPI = true;

      let totalProcessed = 0;
      let totalAssignments = 0;
      let totalBatches = 0;
      const affectedSpaces = new Set<string>(); // Track spaces that received new episodes

      if (shouldUseBatchAPI) {
        logger.info(
          `Using Batch AI processing for ${episodes.length} episodes`,
          {
            mode,
            userId,
            batchSize,
          },
        );

        const batchResult = await processBatchAI(
          episodes,
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
          `Using sequential processing for ${episodes.length} episodes (below batch threshold)`,
          {
            mode,
            userId,
            minRequired: config.minEpisodesForBatch,
          },
        );

        // Fallback to sequential processing for smaller episode sets
        totalBatches = Math.ceil(episodes.length / batchSize);

        for (let i = 0; i < totalBatches; i++) {
          const batch = episodes.slice(i * batchSize, (i + 1) * batchSize);

          logger.info(
            `Processing batch ${i + 1}/${totalBatches} with ${batch.length} episodes`,
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
            },
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

      // 6. Update space status to "ready" after all processing is complete
      if (affectedSpaces.size > 0) {
        try {
          await updateMultipleSpaceStatuses(
            Array.from(affectedSpaces),
            SPACE_STATUS.READY,
            {
              userId,
              operation: "space-assignment",
              metadata: { mode, phase: "completed_processing" },
            },
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

async function getEpisodesToAnalyze(
  userId: string,
  mode: "new_space" | "episode",
  options: { newSpaceId?: string; episodeIds?: string[] },
): Promise<EpisodeData[]> {
  let query: string;
  let params: any = { userId };

  if (mode === "new_space") {
    // For new space: analyze all recent episodes
    query = `
      MATCH (e:Episode {userId: $userId})
      RETURN e
      ORDER BY e.createdAt DESC
      LIMIT 1000
    `;
  } else {
    // For episode mode: analyze specific episodes
    query = `
      UNWIND $episodeIds AS episodeId
      MATCH (e:Episode {uuid: episodeId, userId: $userId})
      RETURN e
      ORDER BY e.createdAt DESC
    `;
    params.episodeIds = options.episodeIds;
  }

  const result = await runQuery(query, params);

  return result.map((record) => {
    const episode = record.get("e").properties;
    return {
      uuid: episode.uuid,
      content: episode.content,
      originalContent: episode.originalContent,
      source: episode.source,
      createdAt: new Date(episode.createdAt),
      metadata: JSON.parse(episode.metadata || "{}"),
    };
  });
}

async function processBatchAI(
  episodes: EpisodeData[],
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
    // Create batches of episodes
    const episodeBatches: EpisodeData[][] = [];
    for (let i = 0; i < episodes.length; i += batchSize) {
      episodeBatches.push(episodes.slice(i, i + batchSize));
    }

    logger.info(
      `Creating ${episodeBatches.length} batch AI requests for ${episodes.length} episodes`,
    );

    // Create batch requests with prompts
    const batchRequests = await Promise.all(
      episodeBatches.map(async (batch, index) => {
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
          customId: `episode-space-assignment-${userId}-${mode}-${index}`,
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
      timeoutMs: 1200000, // 10 minutes timeout
    });

    logger.info(`Batch AI job created: ${batchId}`, {
      userId,
      mode,
      batchRequests: batchRequests.length,
    });

    // Poll for completion with improved handling
    const maxPollingTime = 1200000; // 13 minutes
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
        return await processBatch(episodes, spaces, userId, mode, newSpaceId);
      }

      return { processed: episodes.length, assignments: 0 };
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
        // Extract episode batch info from customId
        const batchIndexMatch = result.customId.match(/-(\d+)$/);
        const batchIndex = batchIndexMatch ? parseInt(batchIndexMatch[1]) : 0;
        const episodeBatch = episodeBatches[batchIndex];

        if (Array.isArray(result.response)) {
          // Handle direct array response (from structured output)
          assignments = result.response.map((a) => ({
            episodeId: a.episodeId,
            spaceIds: a.addSpaceId || [],
            confidence: a.confidence || 0.75,
            reasoning: a.reasoning,
          }));
        } else if (typeof result.response === "string") {
          // Parse from text response with <output> tags (fallback for non-structured output)
          assignments = parseLLMResponseWithTags(
            result.response,
            episodeBatch,
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
                episodeId: a.episodeId,
                spaceIds: a.addSpaceId || [],
                confidence: a.confidence || 0.75,
                reasoning: a.reasoning,
              }));
            } else {
              // Fallback parsing
              assignments = parseLLMResponse(
                JSON.stringify(result.response),
                episodeBatch,
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
            episodeBatch,
            spaces,
          );
        }
      } catch (parseError) {
        logger.error(`Error parsing batch result ${result.customId}:`, {
          error: parseError,
        });
        continue;
      }

      // Group episodes by space for batch assignment
      const spaceToEpisodes = new Map<string, string[]>();

      for (const assignment of assignments) {
        if (
          assignment.spaceIds.length > 0 &&
          assignment.confidence >= confidenceThreshold
        ) {
          for (const spaceId of assignment.spaceIds) {
            if (!spaceToEpisodes.has(spaceId)) {
              spaceToEpisodes.set(spaceId, []);
            }
            spaceToEpisodes.get(spaceId)!.push(assignment.episodeId);
          }
        }
      }

      // Apply batch assignments - one call per space
      for (const [spaceId, episodeIds] of spaceToEpisodes) {
        try {
          const assignmentResult = await assignEpisodesToSpace(
            episodeIds,
            spaceId,
            userId,
          );

          if (assignmentResult.success) {
            totalAssignments += episodeIds.length;
            affectedSpaces.add(spaceId);
            logger.info(
              `Batch AI assigned ${episodeIds.length} episodes to space ${spaceId}`,
              {
                episodeIds,
                mode,
                batchId: result.customId,
              },
            );
          }
        } catch (error) {
          logger.warn(
            `Failed to assign ${episodeIds.length} episodes to space ${spaceId}:`,
            { error, episodeIds },
          );
        }
      }
    }

    // Log final batch processing results
    logger.info(`Batch AI processing completed`, {
      batchId,
      totalEpisodes: episodes.length,
      processedBatches: batch.results.length,
      totalAssignments,
      affectedSpaces: affectedSpaces.size,
      completedRequests: batch.completedRequests,
      failedRequests: batch.failedRequests || 0,
    });

    // If we have significant failures, consider fallback processing for remaining episodes
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
      processed: episodes.length,
      assignments: totalAssignments,
      affectedSpaces: Array.from(affectedSpaces),
    };
  } catch (error) {
    logger.error("Error in Batch AI processing:", { error });
    throw error;
  }
}

async function processBatch(
  episodes: EpisodeData[],
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
      episodes,
      spaces,
      mode,
      newSpaceId,
      userId,
    );

    // Episode-intent matching is MEDIUM complexity (semantic analysis with intent alignment)
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

    // Response text is now set by the callback

    // Parse LLM response
    const assignments = parseLLMResponseWithTags(
      responseText,
      episodes,
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
            const result = await assignEpisodesToSpace(
              [assignment.episodeId],
              spaceId,
              userId,
            );

            if (result.success) {
              totalAssignments++;
              affectedSpaces.add(spaceId);

              logger.info(
                `LLM assigned episode ${assignment.episodeId} to space ${spaceId}`,
                {
                  confidence: assignment.confidence,
                  reasoning: assignment.reasoning || "No reasoning",
                  mode,
                } as Record<string, unknown>,
              );
            }
          } catch (error) {
            logger.warn(
              `Failed to assign episode ${assignment.episodeId} to space ${spaceId}:`,
              error as Record<string, unknown>,
            );
          }
        }
      }
    }

    return {
      processed: episodes.length,
      assignments: totalAssignments,
      affectedSpaces: Array.from(affectedSpaces),
    };
  } catch (error) {
    logger.error("Error processing batch:", error as Record<string, unknown>);
    return { processed: 0, assignments: 0, affectedSpaces: [] };
  }
}

async function createLLMPrompt(
  episodes: EpisodeData[],
  spaces: Space[],
  mode: "new_space" | "episode",
  newSpaceId?: string,
  userId?: string,
): Promise<CoreMessage[]> {
  const episodesDescription = episodes
    .map(
      (ep) =>
        `ID: ${ep.uuid}\nCONTENT: ${ep.content}\nSOURCE: ${ep.source}\nMETADATA: ${JSON.stringify(ep.metadata)}`,
    )
    .join("\n\n");

  // Get enhanced space information with episode counts
  const enhancedSpaces = await Promise.all(
    spaces.map(async (space) => {
      const currentCount = userId
        ? await getSpaceEpisodeCount(space.id, userId)
        : 0;
      return {
        ...space,
        currentEpisodeCount: currentCount,
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
        content: `You are analyzing episodes for assignment to a newly created space based on the space's intent and purpose.

CORE PRINCIPLE: Match episodes based on WHAT THE EPISODE IS FUNDAMENTALLY ABOUT (its primary subject), not just keyword overlap.

STEP-BY-STEP FILTERING PROCESS:

Step 1: IDENTIFY PRIMARY SUBJECT
Ask: "Who or what is this episode fundamentally about?"
- Is it about a specific person? (by name, or "I"/"my" = speaker)
- Is it about a system, tool, or organization?
- Is it about a project, event, or activity?
- Is it about a concept, topic, or idea?

Step 2: HANDLE IMPLICIT SUBJECTS
- "I prefer..." or "My..." → Subject is the SPEAKER (check episode source/metadata for identity)
- "User discussed..." or "Person X said..." → Subject is that specific person
- "We decided..." → Subject is the group/team/project being discussed
- If unclear, identify from context clues in the episode content

Step 3: CHECK SUBJECT ALIGNMENT
Does the PRIMARY SUBJECT match what the space is about?
- Match the subject identity (right person/thing/concept?)
- Match the subject relationship (is episode ABOUT the subject or just MENTIONING it?)
- Match the intent purpose (does episode serve the space's purpose?)
- Check scope constraints: If space description includes scope requirements (e.g., "cross-context", "not app-specific", "broadly useful", "stable for 3+ months"), verify episode meets those constraints

Step 4: DISTINGUISH SUBJECT vs META
Ask: "Is this episode ABOUT the subject itself, or ABOUT discussing/analyzing the subject?"
- ABOUT subject: Episode contains actual content related to subject
- META-discussion: Episode discusses how to handle/analyze/organize the subject
- Only assign if episode is ABOUT the subject, not meta-discussion

Step 5: VERIFY CONFIDENCE
Only assign if confidence >= 0.75 based on:
- Subject identity clarity (is subject clearly identified?)
- Subject alignment strength (how well does it match space intent?)
- Content relevance (does episode content serve space purpose?)

CRITICAL RULE: PRIMARY SUBJECT MATCHING
The episode's PRIMARY SUBJECT must match the space's target subject.
- If space is about Person A, episodes about Person B should NOT match (even if same topic)
- If space is about a specific concept, meta-discussions about that concept should NOT match
- If space is about actual behaviors/facts, process discussions about organizing those facts should NOT match

EXAMPLES OF CORRECT FILTERING:

Example 1 - Person Identity:
Space: "Alex's work preferences"
Episode A: "I prefer morning meetings and async updates" (speaker: Alex) → ASSIGN ✅ (primary subject: Alex's preferences)
Episode B: "Jordan prefers afternoon meetings" (speaker: System) → DO NOT ASSIGN ❌ (primary subject: Jordan, not Alex)

Example 2 - Meta vs Actual:
Space: "Recipe collection"
Episode A: "My lasagna recipe: 3 layers pasta, béchamel, meat sauce..." → ASSIGN ✅ (primary subject: actual recipe)
Episode B: "We should organize recipes by cuisine type" → DO NOT ASSIGN ❌ (primary subject: organizing system, not recipe)

Example 3 - Keyword Overlap Without Subject Match:
Space: "Home renovation project"
Episode A: "Installed new kitchen cabinets, chose oak wood" → ASSIGN ✅ (primary subject: home renovation)
Episode B: "Friend asked advice about their kitchen renovation" → DO NOT ASSIGN ❌ (primary subject: friend's project, not this home)

Example 4 - Scope Constraints:
Space: "Personal identity and preferences (broadly useful across contexts, not app-specific)"
Episode A: "I prefer async communication and morning work hours" → ASSIGN ✅ (cross-context preference, broadly applicable)
Episode B: "Demonstrated knowledge of ProjectX technical stack" → DO NOT ASSIGN ❌ (work/project knowledge, not personal identity)

RESPONSE FORMAT:
Provide your response inside <output></output> tags with a valid JSON array:

<output>
[
  {
    "episodeId": "episode-uuid",
    "addSpaceId": ["${newSpaceId}"],
    "confidence": 0.75,
    "reasoning": "Brief explanation of intent match"
  }
]
</output>

IMPORTANT: If an episode doesn't align with the space's intent, use empty addSpaceId array: []
Example: {"episodeId": "ep-123", "addSpaceId": [], "confidence": 0.0, "reasoning": "No intent alignment"}`,
      },
      {
        role: "user",
        content: `NEW SPACE TO POPULATE:
Name: ${newSpace.name}
Intent/Purpose: ${newSpace.description || "No description"}
Current Episodes: ${newSpace.currentEpisodeCount}

EPISODES TO EVALUATE:
${episodesDescription}

ASSIGNMENT TASK:
For each episode above, follow the step-by-step process to determine if it should be assigned to this space.

Remember:
1. Identify the PRIMARY SUBJECT of each episode (who/what is it about?)
2. Check if that PRIMARY SUBJECT matches what this space is about
3. If the episode is ABOUT something else (even if it mentions related keywords), do NOT assign
4. If the episode is a META-discussion about the space's topic (not actual content), do NOT assign
5. Only assign if the episode's primary subject aligns with the space's intent AND confidence >= 0.75

Provide your analysis and assignments using the specified JSON format.`,
      },
    ];
  } else {
    // Episode mode - consider all spaces
    const spacesDescription = enhancedSpaces
      .map((space) => {
        const spaceInfo = [
          `- ${space.name} (${space.id})`,
          `  Intent/Purpose: ${space.description || "No description"}`,
          `  Current Episodes: ${space.currentEpisodeCount}`,
        ];

        if (space.summary) {
          spaceInfo.push(`  Summary: ${space.summary}`);
        }

        return spaceInfo.join("\n");
      })
      .join("\n\n");

    return [
      {
        role: "system",
        content: `You are an expert at organizing episodes into semantic spaces based on the space's intent and purpose.

CORE PRINCIPLE: Match episodes based on WHAT THE EPISODE IS FUNDAMENTALLY ABOUT (its primary subject), not just keyword overlap.

STEP-BY-STEP FILTERING PROCESS:

Step 1: IDENTIFY PRIMARY SUBJECT
Ask: "Who or what is this episode fundamentally about?"
- Is it about a specific person? (by name, or "I"/"my" = speaker)
- Is it about a system, tool, or organization?
- Is it about a project, event, or activity?
- Is it about a concept, topic, or idea?

Step 2: HANDLE IMPLICIT SUBJECTS
- "I prefer..." or "My..." → Subject is the SPEAKER (check episode source/metadata for identity)
- "User discussed..." or "Person X said..." → Subject is that specific person
- "We decided..." → Subject is the group/team/project being discussed
- If unclear, identify from context clues in the episode content

Step 3: CHECK SUBJECT ALIGNMENT WITH EACH SPACE
For each available space, does the episode's PRIMARY SUBJECT match what that space is about?
- Match the subject identity (right person/thing/concept?)
- Match the subject relationship (is episode ABOUT the subject or just MENTIONING it?)
- Match the intent purpose (does episode serve the space's purpose?)
- An episode can match multiple spaces if its primary subject serves multiple intents

Step 4: DISTINGUISH SUBJECT vs META
Ask: "Is this episode ABOUT the subject itself, or ABOUT discussing/analyzing the subject?"
- ABOUT subject: Episode contains actual content related to subject
- META-discussion: Episode discusses how to handle/analyze/organize the subject
- Only assign if episode is ABOUT the subject, not meta-discussion

Step 5: VERIFY CONFIDENCE
Only assign to a space if confidence >= 0.75 based on:
- Subject identity clarity (is subject clearly identified?)
- Subject alignment strength (how well does it match space intent?)
- Content relevance (does episode content serve space purpose?)

Step 6: MULTI-SPACE ASSIGNMENT
- An episode can belong to multiple spaces if its primary subject serves multiple intents
- Each space assignment should meet the >= 0.75 confidence threshold independently
- If no spaces match, use empty addSpaceId: []

CRITICAL RULE: PRIMARY SUBJECT MATCHING
The episode's PRIMARY SUBJECT must match the space's target subject.
- If space is about Person A, episodes about Person B should NOT match (even if same topic)
- If space is about a specific concept, meta-discussions about that concept should NOT match
- If space is about actual behaviors/facts, process discussions about organizing those facts should NOT match

EXAMPLES OF CORRECT FILTERING:

Example 1 - Person Identity:
Space: "Alex's work preferences"
Episode A: "I prefer morning meetings and async updates" (speaker: Alex) → ASSIGN ✅ (primary subject: Alex's preferences)
Episode B: "Jordan prefers afternoon meetings" (speaker: System) → DO NOT ASSIGN ❌ (primary subject: Jordan, not Alex)

Example 2 - Meta vs Actual:
Space: "Recipe collection"
Episode A: "My lasagna recipe: 3 layers pasta, béchamel, meat sauce..." → ASSIGN ✅ (primary subject: actual recipe)
Episode B: "We should organize recipes by cuisine type" → DO NOT ASSIGN ❌ (primary subject: organizing system, not recipe)

Example 3 - Keyword Overlap Without Subject Match:
Space: "Home renovation project"
Episode A: "Installed new kitchen cabinets, chose oak wood" → ASSIGN ✅ (primary subject: home renovation)
Episode B: "Friend asked advice about their kitchen renovation" → DO NOT ASSIGN ❌ (primary subject: friend's project, not this home)

Example 4 - Scope Constraints:
Space: "Personal identity and preferences (broadly useful across contexts, not app-specific)"
Episode A: "I prefer async communication and morning work hours" → ASSIGN ✅ (cross-context preference, broadly applicable)
Episode B: "I format task titles as {verb}: {title} in TaskApp" → DO NOT ASSIGN ❌ (app-specific behavior, fails "not app-specific" constraint)
Episode C: "Demonstrated knowledge of ProjectX technical stack" → DO NOT ASSIGN ❌ (work/project knowledge, not personal identity)

RESPONSE FORMAT:
Provide your response inside <output></output> tags with a valid JSON array:

<output>
[
  {
    "episodeId": "episode-uuid",
    "addSpaceId": ["space-uuid1", "space-uuid2"],
    "confidence": 0.75,
    "reasoning": "Brief explanation of intent match"
  }
]
</output>

IMPORTANT: If no spaces' intents align with an episode, use empty addSpaceId array: []
Example: {"episodeId": "ep-123", "addSpaceId": [], "confidence": 0.0, "reasoning": "No matching space intent"}`,
      },
      {
        role: "user",
        content: `AVAILABLE SPACES (with their intents/purposes):
${spacesDescription}

EPISODES TO ORGANIZE:
${episodesDescription}

ASSIGNMENT TASK:
For each episode above, follow the step-by-step process to determine which space(s) it should be assigned to.

Remember:
1. Identify the PRIMARY SUBJECT of each episode (who/what is it about?)
2. Check if that PRIMARY SUBJECT matches what each space is about
3. If the episode is ABOUT something else (even if it mentions related keywords), do NOT assign to that space
4. If the episode is a META-discussion about a space's topic (not actual content), do NOT assign to that space
5. An episode can be assigned to multiple spaces if its primary subject serves multiple intents
6. Only assign if the episode's primary subject aligns with the space's intent AND confidence >= 0.75 for that space

Provide your analysis and assignments using the specified JSON format.`,
      },
    ];
  }
}

function parseLLMResponseWithTags(
  response: string,
  episodes: EpisodeData[],
  spaces: Space[],
): AssignmentResult[] {
  try {
    // Extract content from <output> tags
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn(
        "No <output> tags found in LLM response, falling back to full response parsing",
      );
      return parseLLMResponse(response, episodes, spaces);
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
    const validEpisodeIds = new Set(episodes.map((e) => e.uuid));

    return parsed
      .filter((assignment: any) => {
        // Validate assignment structure
        if (
          !assignment.episodeId ||
          !validEpisodeIds.has(assignment.episodeId)
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
        episodeId: assignment.episodeId,
        spaceIds: assignment.addSpaceId,
        confidence: assignment.confidence || 0.75,
        reasoning: assignment.reasoning,
      }));
  } catch (error) {
    logger.error(
      "Error parsing LLM response with tags:",
      error as Record<string, unknown>,
    );
    logger.debug("Raw LLM response:", { response } as Record<string, unknown>);
    // Fallback to regular parsing
    return parseLLMResponse(response, episodes, spaces);
  }
}

function parseLLMResponse(
  response: string,
  episodes: EpisodeData[],
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
    const validEpisodeIds = new Set(episodes.map((e) => e.uuid));

    return parsed.assignments
      .filter((assignment: any) => {
        // Validate assignment structure
        if (
          !assignment.episodeId ||
          !validEpisodeIds.has(assignment.episodeId)
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
        episodeId: assignment.episodeId,
        spaceIds: assignment.spaceIds,
        confidence: assignment.confidence || 0.75,
        reasoning: assignment.reasoning,
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
  return await spaceAssignmentTask.trigger(payload, {
    queue: "space-assignment-queue",
    concurrencyKey: payload.userId,
    tags: [payload.userId],
  });
}

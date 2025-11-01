import { logger } from "~/services/logger.service";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { getEmbedding, makeModelCall } from "~/lib/model.server";
import {
  getCompactedSessionBySessionId,
  linkEpisodesToCompact,
  getSessionEpisodes,
  type CompactedSessionNode,
  type SessionEpisodeData,
  saveCompactedSession,
} from "~/services/graphModels/compactedSession";

export interface SessionCompactionPayload {
  userId: string;
  sessionId: string;
  source: string;
  triggerSource?: "auto" | "manual" | "threshold";
}

export interface SessionCompactionResult {
  success: boolean;
  compactionResult?: {
    compactUuid: string;
    sessionId: string;
    summary: string;
    episodeCount: number;
    startTime: Date;
    endTime: Date;
    confidence: number;
    compressionRatio: number;
  };
  reason?: string;
  episodeCount?: number;
  error?: string;
}

// Zod schema for LLM response validation
export const CompactionResultSchema = z.object({
  summary: z.string().describe("Consolidated narrative of the entire session"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score of the compaction quality"),
});

export const CONFIG = {
  minEpisodesForCompaction: 3, // Minimum episodes to trigger compaction
  compactionThreshold: 1, // Trigger after N new episodes
  maxEpisodesPerBatch: 50, // Process in batches if needed
};

/**
 * Core business logic for session compaction
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processSessionCompaction(
  payload: SessionCompactionPayload,
): Promise<SessionCompactionResult> {
  const { userId, sessionId, source, triggerSource = "auto" } = payload;

  logger.info(`Starting session compaction`, {
    userId,
    sessionId,
    source,
    triggerSource,
  });

  try {
    // Check if compaction already exists
    const existingCompact = await getCompactedSessionBySessionId(
      sessionId,
      userId,
    );

    // Fetch all episodes for this session
    const episodes = await getSessionEpisodes(
      sessionId,
      userId,
      existingCompact?.endTime,
    );

    console.log("episodes", episodes.length);
    // Check if we have enough episodes
    if (!existingCompact && episodes.length < CONFIG.minEpisodesForCompaction) {
      logger.info(`Not enough episodes for compaction`, {
        sessionId,
        episodeCount: episodes.length,
        minRequired: CONFIG.minEpisodesForCompaction,
      });
      return {
        success: false,
        reason: "insufficient_episodes",
        episodeCount: episodes.length,
      };
    } else if (
      existingCompact &&
      episodes.length <
        CONFIG.minEpisodesForCompaction + CONFIG.compactionThreshold
    ) {
      logger.info(`Not enough new episodes for compaction`, {
        sessionId,
        episodeCount: episodes.length,
        minRequired:
          CONFIG.minEpisodesForCompaction + CONFIG.compactionThreshold,
      });
      return {
        success: false,
        reason: "insufficient_new_episodes",
        episodeCount: episodes.length,
      };
    }

    // Generate or update compaction
    const compactionResult = existingCompact
      ? await updateCompaction(existingCompact, episodes, userId)
      : await createCompaction(sessionId, episodes, userId, source);

    logger.info(`Session compaction completed`, {
      sessionId,
      compactUuid: compactionResult.uuid,
      episodeCount: compactionResult.episodeCount,
      compressionRatio: compactionResult.compressionRatio,
    });

    return {
      success: true,
      compactionResult: {
        compactUuid: compactionResult.uuid,
        sessionId: compactionResult.sessionId,
        summary: compactionResult.summary,
        episodeCount: compactionResult.episodeCount,
        startTime: compactionResult.startTime,
        endTime: compactionResult.endTime,
        confidence: compactionResult.confidence,
        compressionRatio: compactionResult.compressionRatio,
      },
    };
  } catch (error) {
    logger.error(`Session compaction failed`, {
      sessionId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create new compaction
 */
async function createCompaction(
  sessionId: string,
  episodes: SessionEpisodeData[],
  userId: string,
  source: string,
): Promise<CompactedSessionNode> {
  logger.info(`Creating new compaction`, {
    sessionId,
    episodeCount: episodes.length,
  });

  // Generate compaction using LLM
  const compactionData = await generateCompaction(episodes, null);

  // Generate embedding for summary
  const summaryEmbedding = await getEmbedding(compactionData.summary);

  // Create CompactedSession node using graph model
  const compactUuid = crypto.randomUUID();
  const now = new Date();
  const startTime = new Date(episodes[0].createdAt);
  const endTime = new Date(episodes[episodes.length - 1].createdAt);
  const episodeUuids = episodes.map((e) => e.uuid);
  const compressionRatio = episodes.length / 1;

  const compactNode: CompactedSessionNode = {
    uuid: compactUuid,
    sessionId,
    summary: compactionData.summary,
    summaryEmbedding,
    episodeCount: episodes.length,
    startTime,
    endTime,
    createdAt: now,
    confidence: compactionData.confidence,
    userId,
    source,
    compressionRatio,
    metadata: { triggerType: "create" },
  };

  console.log("compactNode", compactNode);
  // Use graph model functions
  await saveCompactedSession(compactNode);
  await linkEpisodesToCompact(compactUuid, episodeUuids, userId);

  logger.info(`Compaction created`, {
    compactUuid,
    episodeCount: episodes.length,
  });

  return compactNode;
}

/**
 * Update existing compaction with new episodes
 */
async function updateCompaction(
  existingCompact: CompactedSessionNode,
  newEpisodes: SessionEpisodeData[],
  userId: string,
): Promise<CompactedSessionNode> {
  logger.info(`Updating existing compaction`, {
    compactUuid: existingCompact.uuid,
    newEpisodeCount: newEpisodes.length,
  });

  // Generate updated compaction using LLM (merging)
  const compactionData = await generateCompaction(
    newEpisodes,
    existingCompact.summary,
  );

  // Generate new embedding for updated summary
  const summaryEmbedding = await getEmbedding(compactionData.summary);

  // Update CompactedSession node using graph model
  const now = new Date();
  const endTime = newEpisodes[newEpisodes.length - 1].createdAt;
  const totalEpisodeCount = existingCompact.episodeCount + newEpisodes.length;
  const compressionRatio = totalEpisodeCount / 1;
  const episodeUuids = newEpisodes.map((e) => e.uuid);

  const updatedNode: CompactedSessionNode = {
    ...existingCompact,
    summary: compactionData.summary,
    summaryEmbedding,
    episodeCount: totalEpisodeCount,
    endTime,
    updatedAt: now,
    confidence: compactionData.confidence,
    compressionRatio,
    metadata: { triggerType: "update", newEpisodesAdded: newEpisodes.length },
  };

  // Use graph model functions
  await saveCompactedSession(updatedNode);
  await linkEpisodesToCompact(existingCompact.uuid, episodeUuids, userId);

  logger.info(`Compaction updated`, {
    compactUuid: existingCompact.uuid,
    totalEpisodeCount,
  });

  return updatedNode;
}

/**
 * Generate compaction using LLM (similar to Claude Code's compact approach)
 */
async function generateCompaction(
  episodes: SessionEpisodeData[],
  existingSummary: string | null,
): Promise<z.infer<typeof CompactionResultSchema>> {
  const systemPrompt = createCompactionSystemPrompt();
  const userPrompt = createCompactionUserPrompt(episodes, existingSummary);

  const messages: CoreMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  logger.info(`Generating compaction with LLM`, {
    episodeCount: episodes.length,
    hasExistingSummary: !!existingSummary,
  });

  try {
    let responseText = "";
    await makeModelCall(
      false,
      messages,
      (text: string) => {
        responseText = text;
      },
      undefined,
      "high",
    );

    return parseCompactionResponse(responseText);
  } catch (error) {
    logger.error(`Failed to generate compaction`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * System prompt for compaction (for agent recall/context retrieval)
 */
function createCompactionSystemPrompt(): string {
  return `You are a session compaction specialist. Your task is to create a rich, informative summary that will help AI agents understand what happened in this conversation session when they need context for future interactions.

## PURPOSE

This summary will be retrieved by AI agents when the user references this session in future conversations. The agent needs enough context to:
- Understand what was discussed and why
- Know what decisions were made and their rationale
- Grasp the outcome and current state
- Have relevant technical details to provide informed responses

## COMPACTION GOALS

1. **Comprehensive Context**: Capture all important information that might be referenced later
2. **Decision Documentation**: Clearly state what was decided, why, and what alternatives were considered
3. **Technical Details**: Include specific implementations, tools, configurations, and technical choices
4. **Outcome Clarity**: Make it clear what was accomplished and what the final state is
5. **Evolution Tracking**: Show how thinking or decisions evolved during the session

## COMPACTION RULES

1. **Be Information-Dense**: Pack useful details without fluff or repetition
2. **Structure Chronologically**: Start with problem/question, show progression, end with outcome
3. **Highlight Key Points**: Emphasize decisions, implementations, results, and learnings
4. **Include Specifics**: Names of libraries, specific configurations, metrics, numbers matter
5. **Resolve Contradictions**: Always use the most recent/final version when information conflicts

## OUTPUT REQUIREMENTS

- **summary**: A detailed, information-rich narrative that tells the complete story
  - Structure naturally based on content - use as many paragraphs as needed
  - Each distinct topic, decision, or phase should get its own paragraph(s)
  - Start with context and initial problem/question
  - Progress chronologically through discussions, decisions, and implementations
  - **Final paragraph MUST**: State the outcome, results, and current state
  - Don't artificially limit length - capture everything important

- **confidence**: Score (0-1) reflecting how well this summary captures the session's essence

Your response MUST be valid JSON wrapped in <output></output> tags.

## KEY PRINCIPLES

- Write for an AI agent that needs to help the user in future conversations
- Include technical specifics that might be referenced (library names, configurations, metrics)
- Make outcomes and current state crystal clear in the final paragraph
- Show the reasoning behind decisions, not just the decisions themselves
- Be comprehensive but concise - every sentence should add value
- Each major topic or phase deserves its own paragraph(s)
- Don't compress too much - agents need the details
`;
}

/**
 * User prompt for compaction
 */
function createCompactionUserPrompt(
  episodes: SessionEpisodeData[],
  existingSummary: string | null,
): string {
  let prompt = "";

  if (existingSummary) {
    prompt += `## EXISTING SUMMARY (from previous compaction)\n\n${existingSummary}\n\n`;
    prompt += `## NEW EPISODES (to merge into existing summary)\n\n`;
  } else {
    prompt += `## SESSION EPISODES (to compact)\n\n`;
  }

  episodes.forEach((episode, index) => {
    const timestamp = new Date(episode.validAt).toISOString();
    prompt += `### Episode ${index + 1} (${timestamp})\n`;
    prompt += `Source: ${episode.source}\n`;
    prompt += `Content:\n${episode.originalContent}\n\n`;
  });

  if (existingSummary) {
    prompt += `\n## INSTRUCTIONS\n\n`;
    prompt += `Merge the new episodes into the existing summary. Update facts, add new information, and maintain narrative coherence. Ensure the consolidated summary reflects the complete session including both old and new content.\n`;
  } else {
    prompt += `\n## INSTRUCTIONS\n\n`;
    prompt += `Create a compact summary of this entire session. Consolidate all information into a coherent narrative with deduplicated key facts.\n`;
  }

  return prompt;
}

/**
 * Parse LLM response for compaction
 */
function parseCompactionResponse(
  response: string,
): z.infer<typeof CompactionResultSchema> {
  try {
    // Extract content from <output> tags
    const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch) {
      logger.warn("No <output> tags found in LLM compaction response");
      logger.debug("Full LLM response:", { response });
      throw new Error("Invalid LLM response format - missing <output> tags");
    }

    let jsonContent = outputMatch[1].trim();

    // Remove markdown code blocks if present
    jsonContent = jsonContent.replace(/```json\n?/g, "").replace(/```\n?/g, "");

    const parsed = JSON.parse(jsonContent);

    // Validate with schema
    const validated = CompactionResultSchema.parse(parsed);

    return validated;
  } catch (error) {
    logger.error("Failed to parse compaction response", {
      error: error instanceof Error ? error.message : String(error),
      response: response.substring(0, 500),
    });
    throw new Error(`Failed to parse compaction response: ${error}`);
  }
}

/**
 * Helper function to check if compaction should be triggered
 */
export async function shouldTriggerCompaction(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const existingCompact = await getCompactedSessionBySessionId(
    sessionId,
    userId,
  );

  if (!existingCompact) {
    // Check if we have enough episodes for initial compaction
    const episodes = await getSessionEpisodes(sessionId, userId);
    return episodes.length >= CONFIG.minEpisodesForCompaction;
  }

  // Check if we have enough new episodes to update
  const newEpisodes = await getSessionEpisodes(
    sessionId,
    userId,
    existingCompact.endTime,
  );
  return newEpisodes.length >= CONFIG.compactionThreshold;
}

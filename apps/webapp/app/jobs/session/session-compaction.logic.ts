import { logger } from "~/services/logger.service";
import { z } from "zod";
import { makeModelCall } from "~/lib/model.server";
import {
  getCompactedSessionBySessionId,
  getSessionEpisodes,
} from "~/services/graphModels/compactedSession";
import { type EpisodicNode } from "@core/types";
import { prisma } from "~/db.server";
import { type Document } from "@prisma/client";

import { processTitleGeneration } from "~/jobs/titles/title-generation.logic";
import { type ModelMessage } from "ai";

export interface SessionCompactionPayload {
  userId: string;
  sessionId: string;
  source: string;
  workspaceId: string;
  triggerSource?: "auto" | "manual" | "threshold";
}

export interface SessionCompactionResult {
  success: boolean;
  compactionResult?: {
    sessionId: string;
    summary: string;
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
  minEpisodesForCompaction: 1, // Minimum episodes to trigger compaction
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
  const {
    userId,
    sessionId,
    source,
    workspaceId,
    triggerSource = "auto",
  } = payload;

  logger.info(`Starting session compaction`, {
    userId,
    sessionId,
    source,
    workspaceId,
    triggerSource,
  });

  try {
    // Check if compaction already exists
    const existingCompact = await prisma.document.findFirst({
      where: { sessionId, workspaceId },
    });

    // Fetch all episodes for this session
    const episodes = await getSessionEpisodes(
      sessionId,
      userId,
      existingCompact?.updatedAt
        ? new Date(existingCompact.updatedAt)
        : undefined,
      workspaceId,
    );

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
      episodes.length < CONFIG.compactionThreshold
    ) {
      logger.info(`Not enough new episodes for compaction`, {
        sessionId,
        episodeCount: episodes.length,
        minRequired: CONFIG.compactionThreshold,
      });
      return {
        success: false,
        reason: "insufficient_new_episodes",
        episodeCount: episodes.length,
      };
    }

    // Generate or update compaction
    const compactionResult = existingCompact
      ? await updateCompaction(
          existingCompact,
          episodes,
          userId,
          workspaceId,
          source,
        )
      : await createCompaction(
          sessionId,
          episodes,
          userId,
          workspaceId,
          source,
        );

    if (compactionResult) {
      logger.info(`Session compaction completed`, {
        sessionId,
        compactUuid: compactionResult.id,
      });

      return {
        success: true,
        compactionResult: {
          sessionId: compactionResult.id,
          summary: compactionResult.content,
        },
      };
    }
    return {
      success: false,
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
 * Get title for compacted session
 * Priority: ingestion queue -> first episode metadata -> generated from summary
 */
async function getTitleForCompactedSession(
  sessionId: string,
  summary: string,
  episodes: EpisodicNode[],
  workspaceId: string,
): Promise<string> {
  // 1. Try to get title from ingestion queue (first episode)
  const ingestionRecords = await prisma.ingestionQueue.findMany({
    where: { sessionId, workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      id: true,
    },
    take: 1,
  });

  if (ingestionRecords.length > 0 && ingestionRecords[0].title) {
    logger.info(`Using title from ingestion queue for session ${sessionId}`);
    return ingestionRecords[0].title;
  }

  // 2. Try to get title from first episode metadata
  const metadataTitle = episodes[0]?.metadata?.title;
  if (
    metadataTitle &&
    typeof metadataTitle === "string" &&
    metadataTitle.trim()
  ) {
    logger.info(
      `Using title from first episode metadata for session ${sessionId}`,
    );
    return metadataTitle.trim();
  }

  // 3. If ingestion queue has no title, try to generate one
  if (ingestionRecords.length > 0) {
    logger.info(`Generating title for session ${sessionId}`);
    try {
      const titleResult = await processTitleGeneration({
        queueId: ingestionRecords[0].id,
        userId: episodes[0]?.userId || "",
        workspaceId: "", // Not critical for title generation
      });

      if (titleResult.success && titleResult.title) {
        return titleResult.title;
      }
    } catch (error) {
      logger.warn(`Failed to generate title for session ${sessionId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 4. Fallback: extract first few words from summary
  const cleanSummary = summary
    .replace(/<[^>]*>/g, "") // Strip HTML
    .replace(/#{1,6}\s+/g, "") // Strip markdown headings
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  const truncated = cleanSummary.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 20) {
    return truncated.substring(0, lastSpace) + "...";
  }
  return truncated + (cleanSummary.length > 50 ? "..." : "");
}

/**
 * Upsert Document table entry from compaction
 * Uses sessionId as the Document.id for consistent lookups
 */
async function upsertDocumentFromCompaction(
  sessionId: string,
  summary: string,
  source: string,
  userId: string,
  workspaceId: string,
  episodes: EpisodicNode[],
): Promise<Document | undefined> {
  try {
    // Extract label IDs from first episode (if available)
    const labelIds = episodes[0]?.labelIds || [];

    // Get title using smart title generation
    const title = await getTitleForCompactedSession(
      sessionId,
      summary,
      episodes,
      workspaceId,
    );

    const document = await prisma.document.upsert({
      where: {
        sessionId_workspaceId: {
          sessionId,
          workspaceId,
        },
      },
      create: {
        sessionId,
        title,
        content: summary,
        labelIds,
        source,
        type: "conversation",
        metadata: {
          episodeCount: episodes.length,
          compactedAt: new Date().toISOString(),
        },
        editedBy: userId,
        workspaceId,
      },
      update: {
        title,
        sessionId,
        content: summary,
        updatedAt: new Date(),
        metadata: {
          episodeCount: episodes.length,
          compactedAt: new Date().toISOString(),
        },
      },
    });

    logger.info(`Document table updated for session`, {
      sessionId,
      workspaceId,
      summaryLength: summary.length,
      title,
    });
    return document;
  } catch (error) {
    logger.error(`Failed to upsert Document table`, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
    // Don't throw - allow compaction to succeed even if Document write fails
  }
}

/**
 * Create new compaction
 */
async function createCompaction(
  sessionId: string,
  episodes: EpisodicNode[],
  userId: string,
  workspaceId: string,
  source: string,
): Promise<Document | undefined> {
  logger.info(`Creating new compaction`, {
    sessionId,
    episodeCount: episodes.length,
  });

  // Generate compaction using LLM
  const compactionData = await generateCompaction(episodes, null);

  // Save to graph, vector DB, and Document table in parallel
  const document = await upsertDocumentFromCompaction(
    sessionId,
    compactionData.summary,
    source,
    userId,
    workspaceId,
    episodes,
  );

  logger.info(`Compaction created and stored in vector DB and Document table`, {
    episodeCount: episodes.length,
  });

  return document;
}

/**
 * Update existing compaction with new episodes
 */
async function updateCompaction(
  existingCompact: Document,
  newEpisodes: EpisodicNode[],
  userId: string,
  workspaceId: string,
  source: string,
): Promise<Document | undefined> {
  logger.info(`Updating existing compaction`, {
    compactUuid: existingCompact.id,
    newEpisodeCount: newEpisodes.length,
  });

  // Generate updated compaction using LLM (merging)
  const compactionData = await generateCompaction(
    newEpisodes,
    existingCompact.content,
  );

  // Update graph, vector DB, and Document table in parallel
  const document = await upsertDocumentFromCompaction(
    existingCompact.sessionId as string,
    compactionData.summary,
    source,
    userId,
    workspaceId,
    newEpisodes,
  );

  logger.info(`Compaction updated and stored in vector DB and Document table`, {
    compactUuid: existingCompact.id,
  });

  return document;
}

/**
 * Generate compaction using LLM (similar to Claude Code's compact approach)
 */
async function generateCompaction(
  episodes: EpisodicNode[],
  existingSummary: string | null,
): Promise<z.infer<typeof CompactionResultSchema>> {
  const systemPrompt = createCompactionSystemPrompt();
  const userPrompt = createCompactionUserPrompt(episodes, existingSummary);

  const messages: ModelMessage[] = [
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
      "medium",
      "session-compaction",
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
 * System prompt for compaction - butler's lasting record of a conversation
 * Replaces multiple episodes in recall, also viewable as document by user
 */
function createCompactionSystemPrompt(): string {
  return `A good butler keeps a lasting record of what was discussed, decided, and needs follow-up. You are compressing a conversation into that record. This compact:
1. **REPLACES** all original episodes - agents will ONLY see this summary, never the original conversations
2. Is viewable by the user as a document in their knowledge base

## STRUCTURE

**Single topic session:**
\`\`\`
**Context**: [What this was about - the situation, goal, or problem]
**Details**: [The substance - what was discussed, discovered, decided, done]
**Next**: [Open items, follow-ups - only if any exist]
\`\`\`

**Multi-topic session:**
\`\`\`
## [Topic 1 name]
**Context**: ...
**Details**: ...

## [Topic 2 name]
**Context**: ...
**Details**: ...

## Next
[Combined open items across all topics - only if any exist]
\`\`\`

## PRINCIPLES

- **Preserve everything important**: Agents only see this, not the original. Don't lose context.
- **Capture decision status**: Distinguish between what was decided/confirmed vs suggested/proposed. Use phrases like "User decided...", "Suggested...", "User confirmed...", "Recommended but not yet decided..."
- **Deduplicate**: If the same thing is discussed multiple times, consolidate into one mention with the final/correct state
- **Technical precision**: Keep exact values, code changes, file paths, error messages, specific numbers
- **Entity preservation**: Keep all names, projects, tools, files, URLs, dates exactly as mentioned
- **Proportional length**: Simple sessions = brief. Complex sessions = detailed.
- **No hallucination**: Only include what was actually discussed. Never invent facts, tasks, or conclusions.
- **Next section rules**: Only include items the user explicitly agreed to do or left open. Suggestions the user didn't respond to should stay in Details as "Suggested X (no response)", not in Next.

## EXAMPLES

**Simple session:**
<output>
**Context**: Scheduling team sync meeting
**Details**: User requested a team sync. Created calendar invite for **Team Sync**, Jan 25 2:00-2:30 PM. Attendees: john@company.com, sarah@company.com. User confirmed agenda: Q1 planning review.
</output>

**Health session:**
<output>
## Morning Headaches
**Context**: User reported recurring headaches for 2 weeks, throbbing pain behind eyes at 6-7am
**Details**: Possible causes discussed: screen time before bed, caffeine after 2pm, dehydration. Suggested tracking sleep and water intake - user agreed to try.

## Sleep Issues
**Context**: User mentioned taking 1+ hour to fall asleep, waking at 3am
**Details**: Current habits: phone until midnight, coffee at 4pm. Recommended: no screens after 10pm, caffeine cutoff at 2pm, 10-min meditation before bed. User will try the screen cutoff first.

## Next
- User to track sleep and headaches for 1 week
- Suggested magnesium 300mg before bed (user undecided)
</output>

**Technical debugging session:**
<output>
## Neo4j Datetime Filtering Fix
**Context**: Temporal queries returning 0 episodes despite data existing
**Details**: Investigated and found root cause: type mismatch - \`datetime($startTime)\` compared against ISO strings stored in \`e.createdAt\`. User confirmed the fix: compare strings directly using \`s.validAt >= $startTime\`, \`s.validAt <= $endTime\`, \`s.invalidAt > $now\` with \`new Date().toISOString()\`. Kept APOC \`datetime()\` for Event \`event_date\` (stored correctly). Fix implemented.

## Temporal Reranking
**Context**: Pure temporal queries like "get last 1 week episodes" losing all results after reranking
**Details**: Found reranker scored against meta-intent string which matched nothing, dropping results below 0.1 threshold. Proposed fix: skip reranking when \`Aspects: []\` and sort by recency instead. Queries with aspects like \`[Event, Relationship]\` still use reranker. User approved. Implemented with heuristic: \`hasTopic = entityHints.length > 0 || selectedLabels.length > 0\`.

## Next
- V1 fallback drops temporal constraints in \`memory.ts:167\` (not yet addressed)
- Add aspect filtering to \`handleEntityLookup\` (planned)
</output>

## OUTPUT FORMAT

Wrap in <output></output> tags. Markdown inside.

<output>
[Structured compact - detailed enough that an agent reading ONLY this has full context]
</output>`;
}

/**
 * User prompt for compaction
 */
function createCompactionUserPrompt(
  episodes: EpisodicNode[],
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
    let summaryText: string;
    if (!outputMatch) {
      // Some local/self-hosted models won't follow the tag format; accept raw text.
      logger.warn("No <output> tags found in LLM compaction response; using raw response");
      summaryText = response.trim();
    } else {
      summaryText = outputMatch[1].trim();
    }

    // Return as schema-compliant object (confidence defaults to 1.0 since we're not scoring anymore)
    return {
      summary: summaryText,
      confidence: 1.0,
    };
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
  workspaceId: string,
): Promise<boolean> {
  const existingCompact = await getCompactedSessionBySessionId(
    sessionId,
    userId,
    workspaceId,
  );

  if (!existingCompact) {
    // Check if we have enough episodes for initial compaction
    const episodes = await getSessionEpisodes(
      sessionId,
      userId,
      undefined,
      workspaceId,
    );
    return episodes.length >= CONFIG.minEpisodesForCompaction;
  }

  // Check if we have enough new episodes to update
  const newEpisodes = await getSessionEpisodes(
    sessionId,
    userId,
    new Date(existingCompact.endTime),
    workspaceId,
  );
  return newEpisodes.length >= CONFIG.compactionThreshold;
}

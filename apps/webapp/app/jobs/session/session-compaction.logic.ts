import { logger } from "~/services/logger.service";
import { z } from "zod";
import { makeModelCall } from "~/lib/model.server";
import {
  getCompactedSessionBySessionId,
  getSessionEpisodes,
} from "~/services/graphModels/compactedSession";
import { type EpisodicNode } from "@core/types";
import { prisma } from "~/trigger/utils/prisma";
import { type Document } from "@prisma/client";
import { type CoreMessage } from "ai";
import { processTitleGeneration } from "~/jobs/titles/title-generation.logic";

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
): Promise<string> {
  // 1. Try to get title from ingestion queue (first episode)
  const ingestionRecords = await prisma.ingestionQueue.findMany({
    where: { sessionId },
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
    existingCompact.id,
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
 * System prompt for compaction (for agent recall/context retrieval)
 */
function createCompactionSystemPrompt(): string {
  return `You are a session compaction specialist. Your task is to create a rich, informative summary in Markdown format that will help AI agents understand what happened in this conversation session when they need context for future interactions.

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
2. **Structure with Markdown**: Use headings, lists, and formatting for clarity
3. **Highlight Key Points**: Emphasize decisions, implementations, results, and learnings
4. **Include Specifics**: Names of libraries, specific configurations, metrics, numbers matter
5. **Resolve Contradictions**: Always use the most recent/final version when information conflicts

## OUTPUT REQUIREMENTS - MARKDOWN FORMAT

Write a detailed, information-rich Markdown summary:

**Structure:**
- Use ## heading for main topic/context
- Use ### subheadings for different phases (Discussion, Implementation, Outcome, etc.)
- Use **bold** for key decisions and important terms
- Use \`code\` for technical terms, library names, commands, file paths
- Use bullet lists (-) for multiple items, steps, or specifications
- Use numbered lists (1.) for sequential steps or chronological events
- Include code blocks (\`\`\`) for commands, configurations, or code snippets if relevant

**Content Organization:**
- Start with context and initial problem/question under ## heading
- Progress chronologically through phases with ### subheadings
- **Final section MUST** be ### Outcome or ### Current State with results

**Markdown Tips:**
- Don't over-structure - use paragraphs for narrative flow
- Lists are better for specifications, steps, or multiple related items
- Code formatting makes technical details scannable
- Headings help agents quickly find relevant sections

CRITICAL OUTPUT FORMAT:
You MUST wrap your Markdown summary in <output></output> tags. Output ONLY the Markdown text, nothing else.

Example:
<output>
## Development Environment Setup

The user requested help setting up a new **MacBook Pro** for full-stack development with **React**, **Node.js**, and **Python**.

### Requirements Gathering
- Primary work: Full-stack web development
- Stack: React + Node.js (frontend/backend)
- Additional: Python for data analysis
- Editor preference: VS Code

### Implementation Plan
The following toolchain was recommended:
1. **Homebrew** - Package manager for macOS
2. **nvm** - Node.js version management (v18 LTS recommended)
3. **VS Code** - IDE with extensions:
   - ESLint
   - Prettier
   - GitLens
4. **pyenv** - Python version management (3.11+ recommended)
5. **Git** - Version control with GitHub SSH keys

### Installation Progress
- ✅ Homebrew installed successfully
- 🔄 nvm installation in progress
- ⏳ VS Code, git, and pyenv pending

### Outcome
User successfully installed Homebrew and is proceeding with nvm setup. Next steps: complete nvm installation, configure VS Code with extensions, set up git with SSH keys, install Python via pyenv.
</output>

DO NOT use JSON. DO NOT include field names. Just Markdown text wrapped in <output> tags.

## KEY PRINCIPLES

- Write for an AI agent that needs to help the user in future conversations
- Use Markdown formatting to make technical details scannable
- Make outcomes and current state crystal clear in the final section
- Show the reasoning behind decisions, not just the decisions themselves
- Be comprehensive but well-organized - use headings and lists effectively
- Don't compress too much - agents need the details
- Markdown makes complex information more readable and retrievable
`;
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
    if (!outputMatch) {
      logger.warn("No <output> tags found in LLM compaction response");
      logger.debug("Full LLM response:", { response });
      throw new Error("Invalid LLM response format - missing <output> tags");
    }

    const summaryText = outputMatch[1].trim();

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
    new Date(existingCompact.endTime),
  );
  return newEpisodes.length >= CONFIG.compactionThreshold;
}

/**
 * Label Assignment Logic
 *
 * Uses LLM to extract and assign labels to episodes based on their content.
 * Uses embedding-based similarity search to deduplicate semantically similar labels.
 */

import { z } from "zod";
import { makeStructuredModelCall, getEmbedding } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import { LabelService } from "~/services/label.server";
import { updateEpisodeLabels } from "~/services/graphModels/episode";
import { generateOklchColor } from "~/components/ui/color-utils";
import { type ModelMessage } from "ai";
import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import { countTokens } from "~/services/search/tokenBudget";

const MAX_CONTENT_TOKENS = 20000;

// Similarity threshold for matching labels (higher = stricter matching)
const LABEL_SIMILARITY_THRESHOLD = 0.85;

/**
 * Schema for label extraction
 */
const ExtractedLabelSchema = z.object({
  name: z.string().describe("Label name - 1-3 words, Title Case"),
  description: z
    .string()
    .describe("User-specific description of what they discuss - max 15 words"),
});

const LabelExtractionSchema = z.object({
  labels: z
    .array(ExtractedLabelSchema)
    .describe("Extracted labels (1-3 per episode, empty if none)"),
});

export interface LabelAssignmentPayload {
  queueId: string;
  userId: string;
  workspaceId: string;
}

export interface LabelAssignmentResult {
  success: boolean;
  assignedLabels?: string[]; // IDs of assigned existing labels
  suggestedLabels?: ExtractedLabel[]; // New label suggestions
  error?: string;
}

export interface ExtractedLabel {
  name: string;
  description: string;
  isNew: boolean; // true = suggestion, false = matched existing
  labelId?: string; // Set if matched existing label
}

/**
 * Process label assignment for an ingested episode
 * Extracts labels from episode content - matches existing labels or suggests new ones
 */
export async function processLabelAssignment(
  payload: LabelAssignmentPayload,
): Promise<LabelAssignmentResult> {
  try {
    logger.info(`Processing label assignment for queue ${payload.queueId}`);

    // Fetch the ingestion queue entry
    const ingestionQueue = await prisma.ingestionQueue.findUnique({
      where: { id: payload.queueId },
    });

    if (!ingestionQueue) {
      throw new Error(`Ingestion queue ${payload.queueId} not found`);
    }

    if (ingestionQueue.title === "Persona") {
      logger.info(`Title is Persona for queue ${payload.queueId}`);
      return { success: true, assignedLabels: [] };
    }

    let existingLabelIds: string[] = [];
    let sessionContext: string | undefined;

    // Check Document table for existing labels and session content
    if (ingestionQueue.sessionId) {
      const document = await prisma.document.findFirst({
        where: {
          sessionId: ingestionQueue.sessionId,
          workspaceId: ingestionQueue.workspaceId,
        },
        select: { labelIds: true, content: true },
      });

      if (document?.labelIds && document.labelIds.length > 0) {
        existingLabelIds = document.labelIds;
        logger.info(
          `Found ${existingLabelIds.length} existing labels from document`,
          {
            sessionId: ingestionQueue.sessionId,
            labelIds: existingLabelIds,
          },
        );
      }

      if (document?.content) {
        sessionContext = document.content;
      }
    }

    // Get episode body from the data field
    const data = ingestionQueue.data as any;
    const episodeBody = data?.episodeBody || "";

    if (!episodeBody) {
      logger.warn(`No episode body found for queue ${payload.queueId}`);
      return { success: false, error: "No episode body found" };
    }

    // Get workspace labels
    const labelService = new LabelService();
    const workspaceLabels = (
      await labelService.getWorkspaceLabels(payload.workspaceId)
    ).filter((label) => label.name !== "Persona");

    // Extract labels from episode (matches existing or suggests new)
    const extractedLabels = await extractLabelsFromEpisode(
      episodeBody,
      workspaceLabels.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
      })),
      payload.workspaceId,
      sessionContext,
    );

    // Separate matched vs new labels
    const matchedLabels = extractedLabels.filter((l) => !l.isNew);
    const suggestedLabels = extractedLabels.filter((l) => l.isNew);

    // Get IDs of matched labels
    const matchedLabelIds = matchedLabels
      .map((l) => l.labelId)
      .filter((id): id is string => id !== undefined);

    // Create new labels if any were suggested
    const createdLabelIds: string[] = [];
    const vectorProvider = ProviderFactory.getVectorProvider();

    if (suggestedLabels.length > 0) {
      logger.info(`Creating ${suggestedLabels.length} new labels`, {
        labels: suggestedLabels.map((l) => l.name),
      });

      for (const suggested of suggestedLabels) {
        try {
          const newLabel = await labelService.createLabel({
            name: suggested.name,
            description: suggested.description,
            workspaceId: payload.workspaceId,
            color: generateOklchColor(), // Use the same color generator as UI
          });
          createdLabelIds.push(newLabel.id);
          logger.info(`Created new label: ${newLabel.name} (${newLabel.id})`);

          // Store embedding for the new label
          const labelText = `${suggested.name}: ${suggested.description}`;
          const embedding = await getEmbedding(labelText);

          if (embedding.length > 0) {
            await vectorProvider.upsert({
              id: newLabel.id,
              vector: embedding,
              content: suggested.name,
              metadata: {
                workspaceId: payload.workspaceId,
                description: suggested.description,
              },
              namespace: VECTOR_NAMESPACES.LABEL,
            });
            logger.info(`Stored embedding for label: ${newLabel.name}`);
          }
        } catch (error: any) {
          // If label already exists (race condition), try to find it
          if (error.message.includes("already exists")) {
            const existing = await labelService.getLabelByName(
              suggested.name,
              payload.workspaceId,
            );
            if (existing) {
              createdLabelIds.push(existing.id);
              logger.info(
                `Label ${suggested.name} already exists, using existing ID`,
              );
            }
          } else {
            logger.error(`Failed to create label ${suggested.name}:`, error);
          }
        }
      }
    }

    // Deduplicate: combine existing + matched + newly created labels
    const allLabelIds = Array.from(
      new Set([...existingLabelIds, ...matchedLabelIds, ...createdLabelIds]),
    );
    const newlyAddedCount = allLabelIds.length - existingLabelIds.length;

    logger.info(`Label extraction complete`, {
      queueId: payload.queueId,
      existingCount: existingLabelIds.length,
      matchedCount: matchedLabels.length,
      suggestedCount: suggestedLabels.length,
      createdCount: createdLabelIds.length,
      totalAssigned: allLabelIds.length,
      newlyAdded: newlyAddedCount,
    });

    // Update the ingestion queue with label IDs
    try {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          labels: allLabelIds,
        },
      });
    } catch (error) {
      logger.warn(
        `Could not update ingestion queue ${payload.queueId} with labels - may have been deleted`,
      );
    }

    // Update the Document table if there's a sessionId
    if (ingestionQueue.sessionId) {
      try {
        await prisma.document.update({
          where: {
            sessionId_workspaceId: {
              sessionId: ingestionQueue.sessionId,
              workspaceId: ingestionQueue.workspaceId,
            },
          },
          data: { labelIds: allLabelIds },
        });
        logger.info(
          `Updated document ${ingestionQueue.sessionId} with ${allLabelIds.length} labels`,
        );
      } catch (error: any) {
        logger.warn(`Failed to update document labels:`, {
          error: error.message,
          sessionId: ingestionQueue.sessionId,
          queueId: payload.queueId,
        });
      }

      // Update Neo4j Episodes with the same labelIds
      const updatedCount = await updateEpisodeLabels(
        ingestionQueue.sessionId,
        allLabelIds,
        payload.userId,
        payload.workspaceId,
      );

      logger.info(`Updated ${updatedCount} Neo4j episodes with labels`, {
        queueId: payload.queueId,
        updatedCount,
      });
    }

    return {
      success: true,
      assignedLabels: allLabelIds,
      suggestedLabels: undefined, // All labels are now created and assigned
    };
  } catch (error: any) {
    logger.error(`Error processing label assignment:`, {
      error: error.message,
      queueId: payload.queueId,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Extract labels from episode - matches existing labels OR suggests new ones
 * Uses embedding-based similarity search for semantic deduplication
 */
export async function extractLabelsFromEpisode(
  episodeBody: string,
  availableLabels: Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  workspaceId: string,
  sessionContext?: string,
): Promise<ExtractedLabel[]> {
  const messages = buildLabelExtractionMessages(episodeBody, availableLabels, sessionContext);

  logger.info("Extracting labels from episode", {
    episodeTokens: countTokens(episodeBody),
    sessionContextTokens: sessionContext ? countTokens(sessionContext) : 0,
    availableLabelCount: availableLabels.length,
  });

  const { object: response } = await makeStructuredModelCall(
    LabelExtractionSchema,
    messages,
    "high",
    "label-extraction",
    0.3, // Low temperature for consistent label extraction
  );

  // Create lookup map for existing labels (case-insensitive) for exact matching
  const labelMap = new Map(
    availableLabels.map((l) => [l.name.toLowerCase(), l]),
  );

  const vectorProvider = ProviderFactory.getVectorProvider();
  const extractedLabels: ExtractedLabel[] = [];

  // Process each extracted label
  for (const raw of response.labels) {
    // Step 1: Check for exact name match (case-insensitive)
    const exactMatch = labelMap.get(raw.name.toLowerCase());
    if (exactMatch) {
      extractedLabels.push({
        name: exactMatch.name,
        description: raw.description,
        isNew: false,
        labelId: exactMatch.id,
      });
      logger.info(`Label "${raw.name}" matched existing label by exact name`);
      continue;
    }

    // Step 2: Generate embedding and search for semantically similar labels
    const labelText = `${raw.name}: ${raw.description}`;
    const embedding = await getEmbedding(labelText);

    if (embedding.length > 0) {
      const similarLabels = await vectorProvider.search({
        vector: embedding,
        limit: 1,
        threshold: LABEL_SIMILARITY_THRESHOLD,
        namespace: VECTOR_NAMESPACES.LABEL,
        filter: { workspaceId },
      });

      if (similarLabels.length > 0) {
        // Some vector backends (or invalid stored vectors) can produce NaN/undefined scores.
        // Treat non-finite scores as "no match" to avoid mislabeling everything as similar.
        const topScore = (similarLabels[0] as any)?.score;
        if (typeof topScore !== "number" || !Number.isFinite(topScore)) {
          logger.warn(
            `Ignoring semantic label match for "${raw.name}" due to non-finite similarity score`,
            { score: topScore },
          );
          // Fall through to "new label" behavior.
        } else {
        // Found a semantically similar label - use it instead
        const matchedLabelId = similarLabels[0].id;
        const matchedLabel = availableLabels.find(
          (l) => l.id === matchedLabelId,
        );

        if (matchedLabel) {
          extractedLabels.push({
            name: matchedLabel.name,
            description: raw.description,
            isNew: false,
            labelId: matchedLabel.id,
          });
          const score =
            typeof similarLabels[0].score === "number"
              ? similarLabels[0].score
              : undefined;
          const scoreText =
            score !== undefined && Number.isFinite(score)
              ? score.toFixed(3)
              : "n/a";
          logger.info(
            `Label "${raw.name}" matched existing label "${matchedLabel.name}" by semantic similarity (score: ${scoreText})`,
          );
          continue;
        }
        }
      }
    }

    // Step 3: No match found - mark as new
    extractedLabels.push({
      name: raw.name,
      description: raw.description,
      isNew: true,
    });
    logger.info(`Label "${raw.name}" is new (no semantic match found)`);
  }

  logger.info("Label extraction completed", {
    total: extractedLabels.length,
    matched: extractedLabels.filter((l) => !l.isNew).length,
    new: extractedLabels.filter((l) => l.isNew).length,
  });

  return extractedLabels;
}

/**
 * Build messages for label extraction using HTML tags for clear section management.
 * Applies token-based truncation (MAX_CONTENT_TOKENS) across session context + current episode.
 */
export function buildLabelExtractionMessages(
  episodeBody: string,
  availableLabels: Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  sessionContext?: string,
): ModelMessage[] {
  // Token-aware truncation: prioritise current episode, fill remainder with session context
  const episodeTokens = countTokens(episodeBody);
  let truncatedEpisode = episodeBody;
  let truncatedContext: string | undefined;

  if (episodeTokens > MAX_CONTENT_TOKENS) {
    // Edge case: episode alone exceeds budget — hard-trim from the end
    const chars = Math.floor((MAX_CONTENT_TOKENS / episodeTokens) * episodeBody.length);
    truncatedEpisode = episodeBody.substring(0, chars) + "...[truncated]";
  }

  if (sessionContext) {
    const remaining = MAX_CONTENT_TOKENS - countTokens(truncatedEpisode);
    if (remaining > 200) {
      const contextTokens = countTokens(sessionContext);
      if (contextTokens <= remaining) {
        truncatedContext = sessionContext;
      } else {
        // Keep the most recent part of the session (tail), drop oldest
        const ratio = remaining / contextTokens;
        const startChar = Math.floor((1 - ratio) * sessionContext.length);
        truncatedContext =
          "...[earlier context omitted]\n" + sessionContext.substring(startChar);
      }
    }
  }

  const existingLabelsXml =
    availableLabels.length > 0
      ? `<existing_labels>
${availableLabels
  .map(
    (l) =>
      `  <label name="${l.name}"${l.description ? ` description="${l.description}"` : ""} />`,
  )
  .join("\n")}
</existing_labels>`
      : "<existing_labels />";

  const sessionContextXml = truncatedContext
    ? `<session_context>
${truncatedContext}
</session_context>`
    : "";

  const currentEpisodeXml = `<current_episode>
${truncatedEpisode}
</current_episode>`;

  return [
    {
      role: "system",
      content: `You extract LABELS from episodes for a USER'S PERSONAL KNOWLEDGE SYSTEM.

<core_principle>
Labels are HIGH-LEVEL THEMES the user is actively discussing. They help organise and retrieve episodes later.
Labels must reflect the actual topics the user speaks about — if a user is discussing Search, Authentication, Payments, etc., those deserve labels. Do NOT dismiss topics as "too generic" if the user is substantively engaging with them.
</core_principle>

<what_to_extract>
Extract labels when the episode:
1. Substantially discusses a theme (not just a passing mention)
2. Contains user-specific context about the theme
3. Represents a searchable category for future retrieval

EXTRACT labels for:
- User's projects and work (CORE, API Design, Mobile App)
- User's professional domains and features (Search, AI, Authentication, DevOps)
- User's personal interests (Fitness, Cooking, Photography)
- Recurring activities (Code Review, Team Management, Learning)

DO NOT extract labels for:
- Brief mentions with no substantive content
- Textbook/generic definitions the user is not personally engaged with
- Tools only mentioned in passing without real discussion
</what_to_extract>

<matching_rules>
1. Check existing_labels first — reuse the EXACT name if it fits
2. Create a new label only when no existing label covers the theme
3. Assign labels across all relevant dimensions (project, domain, feature, activity)
</matching_rules>

<label_naming_rules>
- 1-3 words, Title Case
- Use noun form: "Search" not "Searching", "Fitness" not "Getting Fit"
- Be specific but not verbose: "Code Review" not "Code Review Process Guidelines"

Examples:
  TOO VERBOSE           → CLEAN
  Code Review Process   → Code Review
  Database Connection   → Database Setup
  Morning Exercise      → Morning Routine
  Memory Search System  → Memory Search
</label_naming_rules>

<description_rules>
- Max 15 words
- Describe what the USER does/discusses about this topic
- User-specific, not a generic dictionary definition

Examples:
  GENERIC DEFINITION                      → USER-SPECIFIC
  "The practice of physical exercise"     → "User's fat loss goals and workout routine"
  "A software project"                    → "Personal knowledge management system user is building"
  "Database technology"                   → "Graph storage architecture for CORE project"
  "A search algorithm"                    → "Temporal and semantic search routing in CORE memory"
</description_rules>`,
    },
    {
      role: "user",
      content: `Extract labels from the content below.

${existingLabelsXml}

${sessionContextXml}

${currentEpisodeXml}`,
    },
  ];
}

/**
 * Label Assignment Logic
 *
 * Uses LLM to assign appropriate labels to episodes based on their content
 */

import { makeModelCall } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { LabelService } from "~/services/label.server";
import { updateEpisodeLabels } from "~/services/graphModels/episode";

export interface LabelAssignmentPayload {
  queueId: string;
  userId: string;
  workspaceId: string;
}

export interface LabelAssignmentResult {
  success: boolean;
  assignedLabels?: string[];
  error?: string;
}

interface LabelProposal {
  labelName: string;
  confidence: number;
  reason: string;
}

/**
 * Process label assignment for an ingested episode
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

    if (ingestionQueue.sessionId) {
      const latestLog = await prisma.ingestionQueue.findMany({
        where: {
          sessionId: ingestionQueue.sessionId,
        },
        select: {
          labels: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      existingLabelIds = Array.from(
        new Set(latestLog.flatMap((log) => log.labels)),
      );
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
    const workspaceLabels = await labelService.getWorkspaceLabels(
      payload.workspaceId,
    );

    if (workspaceLabels.length === 0) {
      logger.info(
        `No labels defined for workspace ${payload.workspaceId}, skipping assignment`,
      );
      return { success: true, assignedLabels: [] };
    }

    // Get existing labels for this episode
    const existingLabels =
      existingLabelIds.length > 0
        ? await prisma.label.findMany({
            where: {
              id: { in: existingLabelIds },
              workspaceId: payload.workspaceId,
            },
          })
        : [];

    logger.info(`Found ${existingLabels.length} existing labels for episode`, {
      queueId: payload.queueId,
      existingLabels: existingLabels.map((l) => l.name),
    });

    // Call LLM to identify appropriate labels, passing existing labels
    const labelProposals = await identifyLabelsForEpisode(
      episodeBody,
      workspaceLabels.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
      })),
      existingLabels.map((l) => l.name),
    );

    // Create a map of label names to IDs for quick lookup
    const labelNameToIdMap = new Map(
      workspaceLabels.map((l) => [l.name.toLowerCase(), l.id]),
    );

    // Filter high-confidence labels (>= 0.8) and map names to IDs
    const newLabelIds = labelProposals
      .filter((p) => p.confidence >= 0.8)
      .map((p) => {
        const labelId = labelNameToIdMap.get(p.labelName.toLowerCase());
        if (!labelId) {
          logger.warn(
            `Label name from LLM not found in workspace labels: ${p.labelName}`,
          );
          return null;
        }
        return labelId;
      })
      .filter((id): id is string => id !== null);

    // Deduplicate: combine existing + new labels
    const allLabelIds = Array.from(
      new Set([...existingLabelIds, ...newLabelIds]),
    );
    const newlyAddedCount = allLabelIds.length - existingLabelIds.length;

    logger.info(
      `Label assignment complete: ${newlyAddedCount} new labels added`,
      {
        queueId: payload.queueId,
        existingCount: existingLabelIds.length,
        newCount: newLabelIds.length,
        totalCount: allLabelIds.length,
        newlyAdded: newlyAddedCount,
      },
    );

    // Update the ingestion queue with deduplicated label IDs
    await prisma.ingestionQueue.update({
      where: { id: payload.queueId },
      data: {
        labels: allLabelIds,
      },
    });

    // Update Neo4j Episodes with the same labelIds
    const graphIds = (ingestionQueue.graphIds as string[]) || [];
    if (graphIds.length > 0) {
      const updatedCount = await updateEpisodeLabels(
        graphIds,
        allLabelIds,
        payload.userId
      );
      logger.info(`Updated ${updatedCount} Neo4j episodes with labels`, {
        queueId: payload.queueId,
        episodeCount: graphIds.length,
        updatedCount,
      });
    }

    return {
      success: true,
      assignedLabels: allLabelIds,
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
 * Use LLM to identify appropriate labels for episode content
 */
async function identifyLabelsForEpisode(
  episodeBody: string,
  availableLabels: Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  existingLabelNames: string[] = [],
): Promise<LabelProposal[]> {
  const prompt = buildLabelAssignmentPrompt(
    episodeBody,
    availableLabels,
    existingLabelNames,
  );

  logger.info("Identifying labels for episode", {
    episodeLength: episodeBody.length,
    availableLabelCount: availableLabels.length,
    existingLabelCount: existingLabelNames.length,
  });

  // Call LLM with structured output
  let responseText = "";
  await makeModelCall(
    false,
    [{ role: "user", content: prompt }],
    (text) => {
      responseText = text;
    },
    {
      temperature: 0.3,
    },
    "high",
    "label-assignment",
  );

  // Parse the response
  const proposals = parseLabelProposals(responseText);

  logger.info("Label identification completed", {
    proposalCount: proposals.length,
  });

  return proposals;
}

/**
 * Build the prompt for label assignment
 */
function buildLabelAssignmentPrompt(
  episodeBody: string,
  availableLabels: Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  existingLabelNames: string[] = [],
): string {
  const labelsSection = `## Available Labels

The following labels are available for assignment:

${availableLabels
  .map((l) => `- **${l.name}**${l.description ? `: ${l.description}` : ""}`)
  .join("\n")}`;

  const existingLabelsSection =
    existingLabelNames.length > 0
      ? `## Existing Labels

This episode already has the following labels assigned:
${existingLabelNames.map((name) => `- **${name}**`).join("\n")}

**Note**: You should consider these existing labels when making new assignments. Only suggest additional labels that add meaningful categorization beyond what's already assigned.`
      : "";

  const contentSection = `## Episode Content

${episodeBody.substring(0, 2000)}${episodeBody.length > 2000 ? "..." : ""}`;

  return `You are a content categorization expert. Your task is to analyze episode content and assign the most appropriate labels from the available label set.

${labelsSection}

${existingLabelsSection}

${contentSection}

## Task

Analyze the episode content and identify ONLY the most essential labels that are clearly, directly, and substantially relevant.

**Critical Requirements - All Must Be Met**:
1. **Direct Relevance**: The episode content must explicitly and substantially discuss or demonstrate the label's theme. Tangential or passing mentions do NOT qualify.
2. **High Confidence**: You must be highly confident (>= 0.8) that this label accurately represents a core aspect of the content.
3. **Non-Redundant**: Do NOT suggest labels that overlap with existing labels or each other. Each label must add distinct categorization value.
4. **Minimal Set**: Prefer fewer, more accurate labels over comprehensive coverage. Most episodes should have 0-2 labels, rarely 3+.

**Strict Filtering Rules**:
- If existing labels already cover the content adequately, return empty array []
- If content only briefly mentions a topic, do NOT assign that label
- If uncertain whether a label applies, do NOT assign it
- If labels would overlap in meaning, choose only the most specific one
- Generic or vague matches do NOT qualify

## Output Format

Return ONLY a JSON array (empty if no labels meet the strict criteria):

\`\`\`json
[
  {
    "labelName": "Exact label name from available labels",
    "confidence": 0.85,
    "reason": "Specific evidence from content proving this label applies"
  }
]
\`\`\`

**Validation Rules**:
- **labelName**: Must EXACTLY match an available label name (case-sensitive)
- **confidence**: Must be >= 0.8 to be considered (0.7-0.79 is too low)
- **reason**: Must cite specific content evidence, not generic statements
- **Empty array []**: Return if NO labels meet all strict requirements
- **Maximum 2 labels**: Exceed only if content clearly spans 3+ distinct themes

Return ONLY the JSON array with no explanatory text.`;
}

/**
 * Parse label proposals from LLM response
 */
function parseLabelProposals(responseText: string): LabelProposal[] {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : responseText;

    const proposals = JSON.parse(jsonText.trim());

    if (!Array.isArray(proposals)) {
      throw new Error("Response is not an array");
    }

    // Validate and filter proposals
    return proposals
      .filter((p) => {
        return (
          p.labelName && typeof p.confidence === "number" && p.confidence > 0
        );
      })
      .map((p) => ({
        labelName: p.labelName.trim(),
        confidence: p.confidence,
        reason: (p.reason || "").trim(),
      }));
  } catch (error) {
    logger.error("Failed to parse label proposals", {
      error,
      responseText: responseText.substring(0, 500),
    });
    return [];
  }
}

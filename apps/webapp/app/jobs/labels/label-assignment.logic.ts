/**
 * Label Assignment Logic
 *
 * Uses LLM to assign appropriate labels to episodes based on their content
 */

import { makeModelCall } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { LabelService } from "~/services/label.server";

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

    // Call LLM to identify appropriate labels
    const labelProposals = await identifyLabelsForEpisode(
      episodeBody,
      workspaceLabels.map((l) => ({
        name: l.name,
        description: l.description,
      })),
    );

    // Filter high-confidence labels (>= 0.7)
    const highConfidenceLabels = labelProposals
      .filter((p) => p.confidence >= 0.7)
      .map((p) => p.labelName);

    logger.info(
      `Identified ${highConfidenceLabels.length} high-confidence labels`,
      {
        queueId: payload.queueId,
        labels: highConfidenceLabels,
      },
    );

    // Update the ingestion queue with assigned label names
    await prisma.ingestionQueue.update({
      where: { id: payload.queueId },
      data: {
        labels: highConfidenceLabels,
      },
    });

    return {
      success: true,
      assignedLabels: highConfidenceLabels,
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
  availableLabels: Array<{ name: string; description: string | null }>,
): Promise<LabelProposal[]> {
  const prompt = buildLabelAssignmentPrompt(episodeBody, availableLabels);

  logger.info("Identifying labels for episode", {
    episodeLength: episodeBody.length,
    availableLabelCount: availableLabels.length,
  });

  // Call LLM with structured output
  let responseText = "";
  await makeModelCall(
    false, // not streaming
    [{ role: "user", content: prompt }],
    (text) => {
      responseText = text;
    },
    {
      temperature: 0.3, // Lower temperature for more consistent labeling
    },
    "high", // Use medium complexity for label assignment
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
  availableLabels: Array<{ name: string; description: string | null }>,
): string {
  const labelsSection = `## Available Labels

The following labels are available for assignment:

${availableLabels
  .map((l) => `- **${l.name}**${l.description ? `: ${l.description}` : ""}`)
  .join("\n")}`;

  const contentSection = `## Episode Content

${episodeBody.substring(0, 2000)}${episodeBody.length > 2000 ? "..." : ""}`;

  return `You are a content categorization expert. Your task is to analyze episode content and assign the most appropriate labels from the available label set.

${labelsSection}

${contentSection}

## Task

Analyze the episode content above and identify which labels are most appropriate. Consider:

1. **Content relevance**: Does the episode clearly relate to the label's theme?
2. **Confidence**: How certain are you about this assignment?
3. **Multiple labels**: An episode can have multiple labels if it spans multiple themes
4. **Precision over recall**: Only assign labels you're confident about

## Output Format

Return your analysis as a JSON array of label proposals:

\`\`\`json
[
  {
    "labelName": "Exact label name from the available labels",
    "confidence": 0.85,
    "reason": "Brief explanation of why this label applies"
  }
]
\`\`\`

**Important Guidelines**:
- **confidence**: 0.0-1.0 scale (only labels with >= 0.7 will be assigned)
- **labelName**: Must EXACTLY match one of the available label names (case-sensitive)
- **reason**: Short explanation (1-2 sentences) of why this label fits
- Return an empty array [] if no labels are relevant
- Maximum 3-4 labels per episode to avoid over-labeling

Return ONLY the JSON array, no additional text.`;
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

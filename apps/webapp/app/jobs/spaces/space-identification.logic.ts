/**
 * Space Identification Logic
 *
 * Uses LLM to identify appropriate spaces for topics discovered by BERT analysis
 */

import { makeModelCall } from "~/lib/model.server";
import { getEpisode } from "~/services/graphModels/episode";
import { logger } from "~/services/logger.service";
import type { SpaceNode } from "@core/types";

export interface TopicData {
  keywords: string[];
  episodeIds: string[];
}

export interface SpaceProposal {
  name: string;
  intent: string;
  confidence: number;
  reason: string;
  topics: string[]; // Array of topic IDs
}

interface IdentifySpacesParams {
  userId: string;
  topics: Record<string, TopicData>;
}

/**
 * Identify spaces for topics using LLM analysis
 * Takes top 10 keywords and top 5 episodes per topic
 */
export async function identifySpacesForTopics(
  params: IdentifySpacesParams,
): Promise<SpaceProposal[]> {
  const { userId, topics } = params;

  // Get existing spaces for the user
  const existingSpaces = [];

  // Prepare topic data with top 10 keywords and top 5 episodes
  const topicsForAnalysis = await Promise.all(
    Object.entries(topics).map(async ([topicId, topicData]) => {
      // Take top 10 keywords
      const topKeywords = topicData.keywords.slice(0, 10);

      // Take top 5 episodes and fetch their content
      const topEpisodeIds = topicData.episodeIds.slice(0, 5);
      const episodes = await Promise.all(
        topEpisodeIds.map((id) => getEpisode(id)),
      );

      return {
        topicId,
        keywords: topKeywords,
        episodes: episodes
          .filter((e) => e !== null)
          .map((e) => ({
            content: e!.content.substring(0, 500), // Limit to 500 chars per episode
          })),
        episodeCount: topicData.episodeIds.length,
      };
    }),
  );

  // Build the prompt
  const prompt = buildSpaceIdentificationPrompt(
    existingSpaces,
    topicsForAnalysis,
  );

  logger.info("Identifying spaces for topics", {
    userId,
    topicCount: Object.keys(topics).length,
    existingSpaceCount: existingSpaces.length,
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
      temperature: 0.7,
    },
    "high",
    "space-identification",
  );

  // Parse the response
  const proposals = parseSpaceProposals(responseText);

  logger.info("Space identification completed", {
    userId,
    proposalCount: proposals.length,
  });

  return proposals;
}

/**
 * Build the prompt for space identification
 */
function buildSpaceIdentificationPrompt(
  existingSpaces: SpaceNode[],
  topics: Array<{
    topicId: string;
    keywords: string[];
    episodes: Array<{ content: string }>;
    episodeCount: number;
  }>,
): string {
  const existingSpacesSection =
    existingSpaces.length > 0
      ? `## Existing Spaces

The user currently has these spaces:
${existingSpaces.map((s) => `- **${s.name}**: ${s.description || "No description"} (${s.contextCount || 0} episodes)`).join("\n")}

When identifying new spaces, consider if topics fit into existing spaces or if new spaces are needed.`
      : `## Existing Spaces

The user currently has no spaces defined. This is a fresh start for space organization.`;

  const topicsSection = `## Topics Discovered

BERT topic modeling has identified ${topics.length} distinct topics from the user's episodes. Each topic represents a cluster of semantically related content.

${topics
  .map(
    (t, idx) => `### Topic ${idx + 1} (ID: ${t.topicId})
**Episode Count**: ${t.episodeCount}
**Top Keywords**: ${t.keywords.join(", ")}

**Sample Episodes** (showing ${t.episodes.length} of ${t.episodeCount}):
${t.episodes.map((e, i) => `${i + 1}. ${e.content}`).join("\n")}
`,
  )
  .join("\n")}`;

  return `You are a knowledge organization expert. Your task is to analyze discovered topics and identify appropriate "spaces" (thematic containers) for organizing episodic memories.

${existingSpacesSection}

${topicsSection}

## Task

Analyze the topics above and identify spaces that would help organize this content meaningfully. For each space:

1. **Consider existing spaces first**: If topics clearly belong to existing spaces, assign them there
2. **Create new spaces when needed**: If topics represent distinct themes not covered by existing spaces
3. **Group related topics**: Multiple topics can be assigned to the same space if they share a theme
4. **Aim for 20-50 episodes per space**: This is the sweet spot for space cohesion
5. **Focus on user intent**: What would help the user find and understand this content later?

## Output Format

Return your analysis as a JSON array of space proposals. Each proposal should have:

\`\`\`json
[
  {
    "name": "Space name (use existing space name if assigning to existing space)",
    "intent": "Clear description of what this space represents",
    "confidence": 0.85,
    "reason": "Brief explanation of why these topics belong together",
    "topics": ["topic-id-1", "topic-id-2"]
  }
]
\`\`\`

**Important Guidelines**:
- **confidence**: 0.0-1.0 scale indicating how confident you are this is a good grouping
- **topics**: Array of topic IDs (use the exact IDs from above like "0", "1", "-1", etc.)
- **name**: For existing spaces, use the EXACT name. For new spaces, create a clear, concise name
- Only propose spaces with confidence >= 0.6
- Each topic should only appear in ONE space proposal
- Topic "-1" is the outlier topic (noise) - only include if it genuinely fits a theme

Return ONLY the JSON array, no additional text.`;
}

/**
 * Parse space proposals from LLM response
 */
function parseSpaceProposals(responseText: string): SpaceProposal[] {
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
          p.name &&
          p.intent &&
          typeof p.confidence === "number" &&
          p.confidence >= 0.6 &&
          Array.isArray(p.topics) &&
          p.topics.length > 0
        );
      })
      .map((p) => ({
        name: p.name.trim(),
        intent: p.intent.trim(),
        confidence: p.confidence,
        reason: (p.reason || "").trim(),
        topics: p.topics.map((t: any) => String(t)),
      }));
  } catch (error) {
    logger.error("Failed to parse space proposals", {
      error,
      responseText: responseText.substring(0, 500),
    });
    return [];
  }
}

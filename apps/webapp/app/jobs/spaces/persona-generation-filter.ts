/**
 * NEW LLM-based cluster filtering implementation
 *
 * Replace filterPersonaRelevantTopics in persona-generation.logic.ts with this version
 */

import type { EpisodicNode } from "@core/types";
import type { CoreMessage } from "ai";
import { createBatch, getBatch } from "~/lib/batch.server";
import { logger } from "~/services/logger.service";

interface ClusteringOutput {
  topics: Record<
    string,
    {
      keywords: string[];
      episodeIds: string[];
    }
  >;
}

interface ClusterData {
  topicId: string;
  keywords: string[];
  episodeIds: string[];
}

/**
 * Poll batch until completion
 */
async function pollBatchCompletion(batchId: string, maxPollingTime: number) {
  const pollInterval = 5000;
  const startTime = Date.now();

  let batch = await getBatch({ batchId });

  while (batch.status === "processing" || batch.status === "pending") {
    const elapsed = Date.now() - startTime;

    if (elapsed > maxPollingTime) {
      throw new Error(`Batch timed out after ${elapsed}ms`);
    }

    logger.info(`Batch status: ${batch.status}`, {
      batchId,
      completed: batch.completedRequests,
      total: batch.totalRequests,
      elapsed,
    });

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    batch = await getBatch({ batchId });
  }

  if (batch.status === "failed") {
    throw new Error(`Batch failed: ${batchId}`);
  }

  return batch;
}

/**
 * Filter HDBSCAN clusters to only persona-relevant topics using LLM
 *
 * STRATEGY: Use LLM with representative sampling (first, middle, last episodes)
 * to determine if cluster describes communication patterns, work style, or
 * personal preferences (KEEP) vs. project implementation (EXCLUDE)
 *
 * This is more accurate than keyword matching because:
 * - Can understand context (e.g., "email about bug" vs "email writing style")
 * - Distinguishes examples from subjects
 * - Uses cluster keywords (aggregate signal) + episode samples (specific evidence)
 */
export async function filterPersonaRelevantTopics(
  clusters: ClusteringOutput,
  episodes: EpisodicNode[]
): Promise<ClusterData[]> {
  const allClusters = Object.entries(clusters.topics).map(([topicId, data]) => ({
    topicId,
    keywords: data.keywords,
    episodeIds: data.episodeIds,
  }));

  logger.info("Starting LLM-based cluster filtering", {
    totalClusters: allClusters.length,
  });

  // Build filtering prompts for each cluster
  const filteringPrompts = allClusters.map((cluster) => {
    // Get representative sample: first, middle, last
    const clusterEpisodes = episodes.filter((e) =>
      cluster.episodeIds.includes(e.uuid)
    );

    if (clusterEpisodes.length === 0) {
      return null; // Skip clusters with no episodes
    }

    const sampleIndices = [
      0, // First
      Math.floor(clusterEpisodes.length / 2), // Middle
      Math.max(clusterEpisodes.length - 1, 0), // Last
    ];

    const sampleEpisodes = sampleIndices
      .map((i) => clusterEpisodes[i])
      .filter(Boolean);

    const episodeTexts = sampleEpisodes
      .map((e, i) => {
        const position =
          i === 0 ? "early" : i === 1 ? "middle" : "late";
        return `Sample ${i + 1} (${position} in cluster):\n${e.content.slice(0, 400)}...`;
      })
      .join("\n\n");

    return {
      role: "user" as const,
      content: `
You are filtering episode clusters for persona generation. Determine if this cluster is relevant for extracting communication patterns, work style, or personal preferences.

CLUSTER THEME (from ALL ${cluster.episodeIds.length} episodes):
Keywords: ${cluster.keywords.join(", ")}

REPRESENTATIVE SAMPLES (${sampleEpisodes.length} episodes spanning cluster):
${episodeTexts}

INSTRUCTIONS:
1. Keywords show the THEME across ALL ${cluster.episodeIds.length} episodes in this cluster
2. Samples provide SPECIFIC EVIDENCE from different parts of the cluster
3. If samples seem inconsistent with keywords, trust keywords MORE (they represent the full cluster)
4. Determine if this cluster is about HOW the user communicates/works (KEEP) or WHAT they implemented (EXCLUDE)

KEEP IF cluster describes:
- Communication style/strategy (how they write emails, posts, messages, documentation)
- Work preferences (tools, workflows, rituals, processes they prefer)
- Decision-making patterns (how they prioritize, choose approaches, delegate)
- Collaboration style (meetings, feedback, team interactions)
- Personal worldview (beliefs, principles, values, philosophy)
- Learning/growth patterns (how they study, practice, improve)

EXCLUDE IF cluster describes:
- Project implementation details (specific features, bugs, technical architecture)
- Product-specific content that doesn't demonstrate communication strategy
- Technical how-to without workflow/preference insights

CRITICAL: If project work is used as an EXAMPLE of communication strategy, KEEP it.
Examples:
- "When explaining CORE to users, I always start with their pain point" → KEEP (communication strategy)
- "Implement CORE memory graph with Neo4j and Prisma" → EXCLUDE (implementation)
- "For technical posts, I use problem-first hooks and benefit bullets" → KEEP (messaging strategy)

OUTPUT ONLY valid JSON (no markdown, no extra text):
{
  "relevant": true,
  "reason": "Shows communication strategy for technical product messaging",
  "confidence": 0.85
}
      `.trim(),
    };
  });

  // Filter out null prompts (clusters with no episodes)
  const validPrompts = filteringPrompts.filter(Boolean) as CoreMessage[];
  const validClusters = allClusters.filter((_, i) => filteringPrompts[i] !== null);

  if (validPrompts.length === 0) {
    logger.warn("No valid clusters to filter");
    return [];
  }

  // Create batch requests for LLM filtering
  const batchRequests = validPrompts.map((prompt, index) => ({
    customId: `cluster-filter-${validClusters[index].topicId}`,
    messages: [prompt],
    systemPrompt: "",
  }));

  const { batchId } = await createBatch({
    requests: batchRequests,
    maxRetries: 2,
    timeoutMs: 1200000, // 20 min
  });

  logger.info(`Cluster filtering batch created: ${batchId}`, {
    clusterCount: validPrompts.length,
  });

  const batch = await pollBatchCompletion(batchId, 1200000);

  if (!batch.results || batch.results.length === 0) {
    logger.warn("Cluster filtering batch failed, using all clusters as fallback");
    return validClusters;
  }

  // Parse results and filter clusters
  const relevantClusters: ClusterData[] = [];
  for (let i = 0; i < batch.results.length; i++) {
    const result = batch.results[i];
    const cluster = validClusters[i];

    if (result.error || !result.response) {
      logger.warn(`Cluster filtering failed for ${cluster.topicId}`, {
        error: result.error,
      });
      // Include cluster if filtering fails (conservative approach)
      relevantClusters.push(cluster);
      continue;
    }

    try {
      // Parse JSON response
      let decision;
      if (typeof result.response === "string") {
        // Remove markdown code blocks if present
        const cleaned = result.response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        decision = JSON.parse(cleaned);
      } else {
        decision = result.response;
      }

      if (decision.relevant && decision.confidence > 0.6) {
        relevantClusters.push(cluster);
        logger.info(`✅ Cluster ${cluster.topicId} INCLUDED`, {
          keywords: cluster.keywords.slice(0, 5).join(", "),
          reason: decision.reason,
          confidence: decision.confidence,
        });
      } else {
        logger.info(`❌ Cluster ${cluster.topicId} EXCLUDED`, {
          keywords: cluster.keywords.slice(0, 5).join(", "),
          reason: decision.reason,
          confidence: decision.confidence,
        });
      }
    } catch (parseError) {
      logger.warn(`Failed to parse cluster filter response for ${cluster.topicId}`, {
        error: parseError instanceof Error ? parseError.message : "Unknown error",
        response: result.response,
      });
      // Include on parse error (conservative)
      relevantClusters.push(cluster);
    }
  }

  logger.info("✨ LLM cluster filtering complete", {
    originalClusters: allClusters.length,
    relevantClusters: relevantClusters.length,
    filteredOut: allClusters.length - relevantClusters.length,
    filterRate: Math.round(
      ((allClusters.length - relevantClusters.length) / allClusters.length) * 100
    ) + "%",
  });

  return relevantClusters;
}

import { logger } from "~/services/logger.service";
import {
  discoverThematicSpaces,
  type SpaceProposal as ClusteringSpaceProposal,
} from "~/services/clustering.server";
import { SpaceService } from "~/services/space.server";
import { prisma } from "~/trigger/utils/prisma";

// ============================================================================
// Types
// ============================================================================

export interface SpaceDiscoveryPayload {
  userId: string;
  workspaceId: string;
  spaceIds?: string[]; // Optional: limit discovery to specific spaces
  minEpisodeCount?: number; // Minimum episodes per entity (default: 20)
  maxEntities?: number; // Maximum entities to analyze (default: 50)
  autoCreateThreshold?: number; // Auto-create spaces with confidence >= this (default: 80)
}

export interface CreatedSpace {
  id: string;
  name: string;
  description: string;
  confidence: number;
  estimatedEpisodeCount: number;
}

export interface SpaceDiscoveryJobResult {
  success: boolean;
  totalProposals: number;
  highConfidenceProposals: number;
  spacesCreated: number;
  createdSpaces: CreatedSpace[];
  stats: {
    totalEntities: number;
    totalEpisodes: number;
    clustersAnalyzed: number;
  };
  error?: string;
}

// ============================================================================
// Helper: Fetch Existing Spaces
// ============================================================================

/**
 * Fetch all existing spaces for a user to avoid duplicate proposals
 */
async function fetchExistingSpaces(
  workspaceId: string,
): Promise<Array<{ name: string; description: string | null }>> {
  try {
    const spaces = await prisma.space.findMany({
      where: {
        workspaceId,
      },
      select: {
        name: true,
        description: true,
      },
    });

    logger.info(`Fetched ${spaces.length} existing spaces for workspace`, {
      workspaceId,
    });

    return spaces;
  } catch (error) {
    logger.error("Failed to fetch existing spaces", { error, workspaceId });
    return [];
  }
}

// ============================================================================
// Helper: Auto-Create High-Confidence Spaces
// ============================================================================

/**
 * Automatically create spaces with confidence >= threshold
 */
async function autoCreateSpaces(
  proposals: ClusteringSpaceProposal[],
  userId: string,
  workspaceId: string,
  threshold: number,
): Promise<CreatedSpace[]> {
  const spaceService = new SpaceService();
  const createdSpaces: CreatedSpace[] = [];

  // Filter proposals by confidence threshold
  const highConfidenceProposals = proposals.filter(
    (p) => p.confidence >= threshold,
  );

  logger.info(
    `Auto-creating ${highConfidenceProposals.length} spaces with confidence >= ${threshold}%`,
  );

  for (const proposal of highConfidenceProposals) {
    try {
      // Create space using SpaceService
      const space = await spaceService.createSpace({
        name: proposal.name,
        description: proposal.intent, // Use intent as description
        userId,
        workspaceId,
      });

      logger.info(`Auto-created space: "${space.name}" (${space.id})`, {
        confidence: proposal.confidence,
        estimatedEpisodes: proposal.estimatedEpisodeCount,
      });

      createdSpaces.push({
        id: space.id,
        name: space.name,
        description: space.description || "",
        confidence: proposal.confidence,
        estimatedEpisodeCount: proposal.estimatedEpisodeCount,
      });
    } catch (error) {
      logger.error(`Failed to auto-create space "${proposal.name}": ${error}`, {
        proposal,
        error,
      });
      // Continue with other proposals even if one fails
    }
  }

  logger.info(`Successfully created ${createdSpaces.length} spaces`);
  return createdSpaces;
}

// ============================================================================
// Main Job Logic
// ============================================================================

/**
 * Process space discovery job
 *
 * Workflow:
 * 1. Fetch existing spaces to avoid duplicates
 * 2. Run entity-first clustering analysis (discoverThematicSpaces)
 * 3. Filter out proposals that match existing spaces
 * 4. Auto-create spaces with confidence >= threshold (default 80%)
 * 5. Return results with created spaces and statistics
 */
export async function processSpaceDiscovery(
  payload: SpaceDiscoveryPayload,
): Promise<SpaceDiscoveryJobResult> {
  const {
    userId,
    workspaceId,
    spaceIds,
    minEpisodeCount = 20,
    maxEntities = 50,
    autoCreateThreshold = 80,
  } = payload;

  logger.info("Starting space discovery job", {
    userId,
    workspaceId,
    spaceIds,
    minEpisodeCount,
    maxEntities,
    autoCreateThreshold,
  });

  try {
    // Step 1: Fetch existing spaces
    const existingSpaces = await fetchExistingSpaces(workspaceId);

    // Step 2: Run entity-first clustering to discover thematic spaces
    logger.info("Running entity clustering analysis...");
    const discoveryResult = await discoverThematicSpaces({
      userId,
      spaceIds,
      minEpisodeCount,
      maxEntities,
      existingSpaces, // Pass existing spaces to LLM to avoid duplicates
    });

    logger.info("Clustering analysis complete", {
      totalProposals: discoveryResult.proposals.length,
      totalEntities: discoveryResult.stats.totalEntities,
      totalEpisodes: discoveryResult.stats.totalEpisodes,
      clustersAnalyzed: discoveryResult.stats.clustersAnalyzed,
    });

    // Step 3: Auto-create high-confidence spaces
    // Note: LLM already filters out duplicates based on existingSpaces in prompt
    const createdSpaces = await autoCreateSpaces(
      discoveryResult.proposals,
      userId,
      workspaceId,
      autoCreateThreshold,
    );

    // Step 4: Count high-confidence proposals
    const highConfidenceProposals = discoveryResult.proposals.filter(
      (p) => p.confidence >= autoCreateThreshold,
    );

    const result: SpaceDiscoveryJobResult = {
      success: true,
      totalProposals: discoveryResult.proposals.length,
      highConfidenceProposals: highConfidenceProposals.length,
      spacesCreated: createdSpaces.length,
      createdSpaces,
      stats: discoveryResult.stats,
    };

    logger.info(`Space discovery job completed successfully: ${result}`);

    return result;
  } catch (error) {
    logger.error("Space discovery job failed", { error, userId, workspaceId });

    return {
      success: false,
      totalProposals: 0,
      highConfidenceProposals: 0,
      spacesCreated: 0,
      createdSpaces: [],
      stats: {
        totalEntities: 0,
        totalEpisodes: 0,
        clustersAnalyzed: 0,
      },
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

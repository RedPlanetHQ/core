import { prisma } from "~/trigger/utils/prisma";
import { logger } from "~/services/logger.service";

interface WorkspaceMetadata {
  lastTopicAnalysisAt?: string;
  [key: string]: any;
}

/**
 * Check if we should trigger a BERT topic analysis for this workspace
 * Criteria: 20+ new episodes since last analysis (or no previous analysis)
 */
export async function shouldTriggerTopicAnalysis(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  try {
    // Get workspace metadata
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      logger.warn(`Workspace not found: ${workspaceId}`);
      return false;
    }

    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;
    const lastAnalysisAt = metadata.lastTopicAnalysisAt;

    // Count episodes with embeddings from Postgres (same as Python scripts query)
    // This ensures consistency between threshold check and actual topic analysis
    const episodeCount = await prisma.episodeEmbedding.count({
      where: {
        userId,
        ...(lastAnalysisAt && {
          createdAt: { gt: new Date(lastAnalysisAt) },
        }),
      },
    });

    logger.info(
      `[Topic Analysis Check] User: ${userId}, New episodes: ${episodeCount}, Last analysis: ${lastAnalysisAt || "never"}`,
    );

    // Trigger if 20+ new episodes
    return episodeCount >= 20;
  } catch (error) {
    logger.error(
      `[Topic Analysis Check] Error checking episode count:`,
      {error},
    );
    return false;
  }
}

/**
 * Update workspace metadata with last topic analysis timestamp
 */
export async function updateLastTopicAnalysisTime(
  workspaceId: string,
): Promise<void> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      logger.warn(`Workspace not found: ${workspaceId}`);
      return;
    }

    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        metadata: {
          ...metadata,
          lastTopicAnalysisAt: new Date().toISOString(),
        },
      },
    });

    logger.info(
      `[Topic Analysis] Updated last analysis timestamp for workspace: ${workspaceId}`,
    );
  } catch (error) {
    logger.error(
      `[Topic Analysis] Error updating last analysis timestamp:`,
      {error},
    );
  }
}

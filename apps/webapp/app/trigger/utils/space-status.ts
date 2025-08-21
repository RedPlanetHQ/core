import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

/**
 * Update space status with proper error handling and logging
 */
export async function updateSpaceStatus(
  spaceId: string,
  status: string,
  context?: {
    userId?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await prisma.space.update({
      where: { id: spaceId },
      data: { status },
    });
    
    logger.info(`Updated space status`, {
      spaceId,
      status,
      userId: context?.userId,
      operation: context?.operation,
      metadata: context?.metadata,
    });
  } catch (error) {
    logger.error(`Failed to update space status`, {
      spaceId,
      status,
      error: error instanceof Error ? error.message : "Unknown error",
      userId: context?.userId,
      operation: context?.operation,
    });
    throw error;
  }
}

/**
 * Batch update multiple space statuses
 */
export async function updateMultipleSpaceStatuses(
  spaceIds: string[],
  status: string,
  context?: {
    userId?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (spaceIds.length === 0) return;

  try {
    logger.info(`Updating status for ${spaceIds.length} spaces`, {
      status,
      spaceIds,
      userId: context?.userId,
      operation: context?.operation,
    });

    const updatePromises = spaceIds.map(async (spaceId) => {
      try {
        await updateSpaceStatus(spaceId, status, {
          ...context,
          metadata: {
            ...context?.metadata,
            batchOperation: true,
          },
        });
      } catch (error) {
        logger.warn(`Failed to update status in batch for space ${spaceId}`, {
          error: error instanceof Error ? error.message : "Unknown error",
          status,
          userId: context?.userId,
        });
        // Don't throw - let other updates continue
      }
    });

    await Promise.allSettled(updatePromises);
    
    logger.info(`Completed batch status update`, {
      status,
      totalSpaces: spaceIds.length,
      userId: context?.userId,
      operation: context?.operation,
    });
  } catch (error) {
    logger.error(`Failed batch space status update`, {
      spaceIds,
      status,
      error: error instanceof Error ? error.message : "Unknown error",
      userId: context?.userId,
      operation: context?.operation,
    });
    throw error;
  }
}

/**
 * Space status constants
 */
export const SPACE_STATUS = {
  READY: "ready",
  PROCESSING: "processing",
  ERROR: "error",
  PENDING: "pending",
} as const;

export type SpaceStatus = typeof SPACE_STATUS[keyof typeof SPACE_STATUS];
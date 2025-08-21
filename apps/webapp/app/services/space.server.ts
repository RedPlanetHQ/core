import { logger } from "./logger.service";
import {
  type SpaceNode,
  type CreateSpaceParams,
  type UpdateSpaceParams,
  type SpaceAssignmentResult,
} from "@core/types";
import { prisma } from "~/db.server";

import { triggerSpaceAssignment } from "~/trigger/spaces/space-assignment";
import {
  assignStatementsToSpace,
  createSpace,
  deleteSpace,
  getSpace,
  getSpaceStatements,
  initializeStatementSpaceIds,
  removeStatementsFromSpace,
  updateSpace,
} from "./graphModels/space";
import { type Space } from "@prisma/client";

export class SpaceService {
  /**
   * Create a new space for a user
   */
  async createSpace(params: CreateSpaceParams): Promise<Space> {
    logger.info(`Creating space "${params.name}" for user ${params.userId}`);

    // Validate input
    if (!params.name || params.name.trim().length === 0) {
      throw new Error("Space name is required");
    }

    if (params.name.length > 100) {
      throw new Error("Space name too long (max 100 characters)");
    }

    if (params.description && params.description.length > 1000) {
      throw new Error("Space description too long (max 1000 characters)");
    }

    // Check for duplicate names
    const existingSpaces = await prisma.space.findMany({
      where: {
        name: params.name,
        workspaceId: params.workspaceId,
      },
    });
    if (existingSpaces.length > 0) {
      throw new Error("A space with this name already exists");
    }

    const space = await prisma.space.create({
      data: {
        name: params.name.trim(),
        description: params.description?.trim(),
        workspaceId: params.workspaceId,
      },
    });

    await createSpace(
      space.id,
      params.name.trim(),
      params.description?.trim(),
      params.userId,
    );

    logger.info(`Created space ${space.id} successfully`);

    // Trigger automatic LLM assignment for the new space
    try {
      await triggerSpaceAssignment({
        userId: params.userId,
        workspaceId: params.workspaceId,
        mode: "new_space",
        newSpaceId: space.id,
        batchSize: 25, // Analyze recent statements for the new space
      });

      logger.info(`Triggered LLM space assignment for new space ${space.id}`);
    } catch (error) {
      // Don't fail space creation if LLM assignment fails
      logger.warn(
        `Failed to trigger LLM assignment for space ${space.id}:`,
        error as Record<string, unknown>,
      );
    }

    return space;
  }

  /**
   * Get all spaces for a user
   */
  async getUserSpaces(userId: string): Promise<Space[]> {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
      },
      include: {
        Workspace: true,
      },
    });

    return await prisma.space.findMany({
      where: {
        workspaceId: user?.Workspace?.id,
      },
    });
  }

  /**
   * Get a specific space by ID
   */
  async getSpace(spaceId: string, userId: string) {
    const space = await prisma.space.findUnique({
      where: {
        id: spaceId,
      },
    });

    const nodeData = await getSpace(spaceId, userId);

    return {
      ...(nodeData as SpaceNode),
      ...space,
    };
  }

  /**
   * Update a space
   */
  async updateSpace(
    spaceId: string,
    updates: UpdateSpaceParams,
    userId: string,
  ): Promise<Space> {
    logger.info(`Updating space ${spaceId} for user ${userId}`);

    // Validate input
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error("Space name cannot be empty");
      }

      if (updates.name.length > 100) {
        throw new Error("Space name too long (max 100 characters)");
      }

      // Check for duplicate names (excluding current space)
      const existingSpaces = await prisma.space.findMany({
        where: {
          name: updates.name,
          workspaceId: userId,
        },
      });
      const duplicates = existingSpaces.filter((space) => space.id !== spaceId);
      if (duplicates.length > 0) {
        throw new Error("A space with this name already exists");
      }
    }

    if (
      updates.description !== undefined &&
      updates.description.length > 1000
    ) {
      throw new Error("Space description too long (max 1000 characters)");
    }

    const space = await prisma.space.update({
      where: {
        id: spaceId,
      },
      data: {
        name: updates.name,
        description: updates.description,
        icon: updates.icon,
      },
    });
    try {
      await updateSpace(spaceId, updates, userId);
    } catch (e) {
      logger.info(`Nothing to update to graph`);
    }
    logger.info(`Updated space ${spaceId} successfully`);
    return space;
  }

  /**
   * Delete a space and clean up all statement references
   */
  async deleteSpace(spaceId: string, userId: string): Promise<Space> {
    logger.info(`Deleting space ${spaceId} for user ${userId}`);

    const space = await prisma.space.delete({
      where: {
        id: spaceId,
      },
    });

    if (space.name === "Profile") {
      throw new Error("Bad request");
    }

    await deleteSpace(spaceId, userId);

    logger.info(`Deleted space ${spaceId} successfully`);

    return space;
  }

  /**
   * Assign statements to a space
   */
  async assignStatementsToSpace(
    statementIds: string[],
    spaceId: string,
    userId: string,
  ): Promise<SpaceAssignmentResult> {
    logger.info(
      `Assigning ${statementIds.length} statements to space ${spaceId} for user ${userId}`,
    );

    // Validate input
    if (statementIds.length === 0) {
      throw new Error("No statement IDs provided");
    }

    if (statementIds.length > 1000) {
      throw new Error("Too many statements (max 1000 per operation)");
    }

    const result = await assignStatementsToSpace(statementIds, spaceId, userId);

    if (result.success) {
      logger.info(
        `Successfully assigned ${result.statementsUpdated} statements to space ${spaceId}`,
      );
    } else {
      logger.warn(
        `Failed to assign statements to space ${spaceId}: ${result.error}`,
      );
    }

    return result;
  }

  /**
   * Remove statements from a space
   */
  async removeStatementsFromSpace(
    statementIds: string[],
    spaceId: string,
    userId: string,
  ): Promise<SpaceAssignmentResult> {
    logger.info(
      `Removing ${statementIds.length} statements from space ${spaceId} for user ${userId}`,
    );

    // Validate input
    if (statementIds.length === 0) {
      throw new Error("No statement IDs provided");
    }

    if (statementIds.length > 1000) {
      throw new Error("Too many statements (max 1000 per operation)");
    }

    const result = await removeStatementsFromSpace(
      statementIds,
      spaceId,
      userId,
    );

    if (result.success) {
      logger.info(
        `Successfully removed ${result.statementsUpdated} statements from space ${spaceId}`,
      );
    } else {
      logger.warn(
        `Failed to remove statements from space ${spaceId}: ${result.error}`,
      );
    }

    return result;
  }

  /**
   * Get all statements in a space
   */
  async getSpaceStatements(spaceId: string, userId: string) {
    logger.info(`Fetching statements for space ${spaceId} for user ${userId}`);
    return await getSpaceStatements(spaceId, userId);
  }

  /**
   * Search spaces by name
   */
  async searchSpacesByName(
    query: string,
    workspaceId: string,
  ): Promise<Space[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    return await prisma.space.findMany({
      where: {
        workspaceId,
        name: {
          contains: query,
          mode: "insensitive",
        },
      },
    });
  }

  /**
   * Get spaces that contain specific statements
   */
  async getSpacesForStatements(
    statementIds: string[],
    userId: string,
  ): Promise<{ statementId: string; spaces: Space[] }[]> {
    const userSpaces = await this.getUserSpaces(userId);
    const result: { statementId: string; spaces: Space[] }[] = [];

    for (const statementId of statementIds) {
      const spacesContainingStatement = [];

      for (const space of userSpaces) {
        const statements = await this.getSpaceStatements(space.id, userId);
        if (statements.some((stmt) => stmt.uuid === statementId)) {
          spacesContainingStatement.push(space);
        }
      }

      result.push({
        statementId,
        spaces: spacesContainingStatement,
      });
    }

    return result;
  }

  /**
   * Initialize spaceIds for existing statements (migration utility)
   */
  async initializeSpaceIds(userId?: string): Promise<number> {
    logger.info(
      `Initializing spaceIds for ${userId ? `user ${userId}` : "all users"}`,
    );

    const updatedCount = await initializeStatementSpaceIds(userId);

    logger.info(`Initialized spaceIds for ${updatedCount} statements`);
    return updatedCount;
  }

  /**
   * Validate space access
   */
  async validateSpaceAccess(spaceId: string, userId: string): Promise<boolean> {
    const space = await this.getSpace(spaceId, userId);
    return space !== null && space.isActive;
  }

  /**
   * Bulk assign statements to multiple spaces
   */
  async bulkAssignStatements(
    statementIds: string[],
    spaceIds: string[],
    userId: string,
  ): Promise<{ spaceId: string; result: SpaceAssignmentResult }[]> {
    logger.info(
      `Bulk assigning ${statementIds.length} statements to ${spaceIds.length} spaces for user ${userId}`,
    );

    const results: { spaceId: string; result: SpaceAssignmentResult }[] = [];

    for (const spaceId of spaceIds) {
      try {
        const result = await this.assignStatementsToSpace(
          statementIds,
          spaceId,
          userId,
        );
        results.push({ spaceId, result });
      } catch (error) {
        results.push({
          spaceId,
          result: {
            success: false,
            statementsUpdated: 0,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    return results;
  }
}

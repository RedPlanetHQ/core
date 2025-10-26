import { logger } from "./logger.service";
import {
  type SpaceNode,
  type CreateSpaceParams,
  type UpdateSpaceParams,
} from "@core/types";
import { type Space } from "@prisma/client";

import {
  assignEpisodesToSpace,
  createSpace,
  deleteSpace,
  getSpace,
  getSpaceEpisodes,
  removeEpisodesFromSpace,
  updateSpace,
} from "./graphModels/space";
import { prisma } from "~/trigger/utils/prisma";
import { trackFeatureUsage } from "./telemetry.server";
import { enqueueSpaceAssignment } from "~/lib/queue-adapter.server";

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
        status: "ready",
      },
    });

    await createSpace(
      space.id,
      params.name.trim(),
      params.description?.trim(),
      params.userId,
    );

    logger.info(`Created space ${space.id} successfully`);

    // Track space creation
    trackFeatureUsage("space_created", params.userId).catch(console.error);

    // Trigger automatic LLM assignment for the new space
    try {
      await enqueueSpaceAssignment({
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

  async getSpaceByName(name: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
      },
      include: {
        Workspace: true,
      },
    });

    const space = await prisma.space.findFirst({
      where: {
        name: name,
        workspaceId: user?.Workspace?.id,
      },
    });

    return space;
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

    const space = await prisma.space.update({
      where: {
        id: spaceId,
      },
      data: {
        name: updates.name,
        description: updates.description,
        icon: updates.icon,
        status: updates.status,
      },
    });
    try {
      await updateSpace(spaceId, updates, userId);
    } catch (e) {
      logger.info(`Nothing to update to graph`);
    }

    // Track space update
    trackFeatureUsage("space_updated", userId).catch(console.error);

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
   * Reset a space by clearing all episode assignments, summary, and metadata
   */
  async resetSpace(spaceId: string, userId: string): Promise<Space> {
    logger.info(`Resetting space ${spaceId} for user ${userId}`);

    // Get the space first to verify it exists and get its details
    const space = await prisma.space.findUnique({
      where: {
        id: spaceId,
      },
    });

    if (!space) {
      throw new Error("Space not found");
    }

    // Delete all relationships in Neo4j (episodes, statements, etc.)
    await deleteSpace(spaceId, userId);

    // Recreate the space in Neo4j (clean slate)
    await createSpace(
      space.id,
      space.name.trim(),
      space.description?.trim(),
      userId,
    );

    // Reset all summary and metadata fields in PostgreSQL
    const resetSpace = await prisma.space.update({
      where: {
        id: spaceId,
      },
      data: {
        summary: null,
        themes: [],
        contextCount: null,
        status: "pending",
        summaryGeneratedAt: null,
        lastPatternTrigger: null,
      },
    });

    logger.info(`Reset space ${spaceId} successfully`);

    return resetSpace;
  }

  /**
   * Get all episodes in a space
   */
  async getSpaceEpisodes(spaceId: string, userId: string) {
    logger.info(`Fetching episodes for space ${spaceId} for user ${userId}`);
    return await getSpaceEpisodes(spaceId, userId);
  }

  /**
   * Assign episodes to a space
   */
  async assignEpisodesToSpace(
    episodeIds: string[],
    spaceId: string,
    userId: string,
  ) {
    logger.info(
      `Assigning ${episodeIds.length} episodes to space ${spaceId} for user ${userId}`,
    );

    await assignEpisodesToSpace(episodeIds, spaceId, userId);

    logger.info(
      `Successfully assigned ${episodeIds.length} episodes to space ${spaceId}`,
    );
  }

  /**
   * Remove episodes from a space
   */
  async removeEpisodesFromSpace(
    episodeIds: string[],
    spaceId: string,
    userId: string,
  ) {
    logger.info(
      `Removing ${episodeIds.length} episodes from space ${spaceId} for user ${userId}`,
    );

    await removeEpisodesFromSpace(episodeIds, spaceId, userId);

    logger.info(
      `Successfully removed ${episodeIds.length} episodes from space ${spaceId}`,
    );
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
   * Validate space access
   */
  async validateSpaceAccess(spaceId: string, userId: string): Promise<boolean> {
    const space = await this.getSpace(spaceId, userId);
    return space !== null && space.isActive;
  }
}

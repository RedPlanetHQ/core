import { logger } from "./logger.service";
import { type Label } from "@prisma/client";
import { prisma } from "~/trigger/utils/prisma";

export interface CreateLabelParams {
  name: string;
  description?: string;
  workspaceId: string;
  color: string;
}

export interface UpdateLabelParams {
  name?: string;
  description?: string;
  color?: string;
}

export class LabelService {
  /**
   * Create a new label for a workspace
   */
  async createLabel(params: CreateLabelParams): Promise<Label> {
    logger.info(
      `Creating label "${params.name}" for workspace ${params.workspaceId}`,
    );

    // Validate input
    if (!params.name || params.name.trim().length === 0) {
      throw new Error("Label name is required");
    }

    if (params.name.length > 100) {
      throw new Error("Label name too long (max 100 characters)");
    }

    // Check for duplicate names in workspace
    const existingLabels = await prisma.label.findMany({
      where: {
        name: params.name,
        workspaceId: params.workspaceId,
      },
    });
    if (existingLabels.length > 0) {
      throw new Error("A label with this name already exists");
    }

    const label = await prisma.label.create({
      data: {
        name: params.name.trim(),
        description: params.description?.trim(),
        workspaceId: params.workspaceId,
        color: params.color,
      },
    });

    logger.info(`Created label ${label.id} successfully`);

    return label;
  }

  /**
   * Get all labels for a workspace
   */
  async getWorkspaceLabels(workspaceId: string): Promise<Label[]> {
    return await prisma.label.findMany({
      where: {
        workspaceId: workspaceId,
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  /**
   * Get label by name in workspace
   */
  async getLabelByName(
    name: string,
    workspaceId: string,
  ): Promise<Label | null> {
    return await prisma.label.findFirst({
      where: {
        name: name,
        workspaceId: workspaceId,
      },
    });
  }

  /**
   * Get a specific label by ID
   */
  async getLabel(labelId: string): Promise<Label | null> {
    return await prisma.label.findUnique({
      where: {
        id: labelId,
      },
    });
  }

  /**
   * Update a label
   */
  async updateLabel(
    labelId: string,
    updates: UpdateLabelParams,
    workspaceId: string,
  ): Promise<Label> {
    logger.info(`Updating label ${labelId} for workspace ${workspaceId}`);

    // Validate input
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error("Label name cannot be empty");
      }

      if (updates.name.length > 100) {
        throw new Error("Label name too long (max 100 characters)");
      }

      // Check for duplicate names (excluding current label)
      const existingLabels = await prisma.label.findMany({
        where: {
          name: updates.name,
          workspaceId: workspaceId,
        },
      });
      const duplicates = existingLabels.filter((label) => label.id !== labelId);
      if (duplicates.length > 0) {
        throw new Error("A label with this name already exists");
      }
    }

    const label = await prisma.label.update({
      where: {
        id: labelId,
      },
      data: {
        name: updates.name?.trim(),
        description: updates.description?.trim(),
      },
    });

    logger.info(`Updated label ${labelId} successfully`);
    return label;
  }

  /**
   * Delete a label
   */
  async deleteLabel(labelId: string): Promise<Label> {
    logger.info(`Deleting label ${labelId}`);

    const label = await prisma.label.delete({
      where: {
        id: labelId,
      },
    });

    // Note: Episodes with this labelId will keep the ID in their labelIds array
    // You may want to add cleanup logic to remove labelId from all episodes

    logger.info(`Deleted label ${labelId} successfully`);

    return label;
  }

  /**
   * Search labels by name in workspace
   */
  async searchLabelsByName(
    query: string,
    workspaceId: string,
  ): Promise<Label[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    return await prisma.label.findMany({
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
   * Validate label access (check if label exists and belongs to workspace)
   */
  async validateLabelAccess(
    labelId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const label = await prisma.label.findUnique({
      where: {
        id: labelId,
        workspaceId: workspaceId,
      },
    });
    return label !== null;
  }
}

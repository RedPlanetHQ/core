import { logger } from "./logger.service";
import { prisma } from "~/trigger/utils/prisma";

export interface FavoriteItem {
  type: 'episode' | 'session' | 'document';
  id: string;
  addedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  items: FavoriteItem[];
}

export interface FolderStructure {
  folders: Folder[];
}

export class FolderService {
  /**
   * Get folder structure for a user
   */
  async getFolders(userId: string): Promise<FolderStructure> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { folders: true },
    });

    if (!user?.folders) {
      return { folders: [] };
    }

    return user.folders as FolderStructure;
  }

  /**
   * Update entire folder structure for a user
   */
  async updateFolders(userId: string, folderStructure: FolderStructure): Promise<FolderStructure> {
    logger.info(`Updating folders for user ${userId}`);

    // Validate structure
    if (!folderStructure || !Array.isArray(folderStructure.folders)) {
      throw new Error("Invalid folder structure");
    }

    // Validate each folder
    for (const folder of folderStructure.folders) {
      if (!folder.id || !folder.name) {
        throw new Error("Each folder must have an id and name");
      }
      if (!Array.isArray(folder.items)) {
        throw new Error("Each folder must have an items array");
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { folders: folderStructure as any },
    });

    logger.info(`Updated folders for user ${userId} successfully`);

    return folderStructure;
  }
}

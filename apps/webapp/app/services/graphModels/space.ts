import { runQuery } from "~/lib/neo4j.server";
import {
  type SpaceNode,
  type SpaceDeletionResult,
  type SpaceAssignmentResult,
} from "@core/types";
import { prisma } from "~/db.server";
import { type Space } from "@prisma/client";
import { logger } from "~/services/logger.service";

/**
 * Create a new space for a user
 */
export async function createSpace(
  spaceId: string,
  name: string,
  description: string | undefined,
  userId: string,
): Promise<SpaceNode> {
  const query = `
    CREATE (s:Space {
      uuid: $spaceId,
      name: $name,
      description: $description,
      userId: $userId,
      createdAt: datetime(),
      updatedAt: datetime(),
      isActive: true
    })
    RETURN s
  `;

  const result = await runQuery(query, { spaceId, name, description, userId });
  if (result.length === 0) {
    throw new Error("Failed to create space");
  }

  const spaceData = result[0].get("s").properties;
  return {
    uuid: spaceData.uuid,
    name: spaceData.name,
    description: spaceData.description,
    userId: spaceData.userId,
    createdAt: new Date(spaceData.createdAt),
    updatedAt: new Date(spaceData.updatedAt),
    isActive: spaceData.isActive,
  };
}

/**
 * Get a specific space by ID
 */
export async function getSpace(
  spaceId: string,
  userId: string,
): Promise<SpaceNode | null> {
  const query = `
    MATCH (s:Space {uuid: $spaceId, userId: $userId})
    WHERE s.isActive = true
    
    // Count statements in this space
    OPTIONAL MATCH (stmt:Statement)
    WHERE stmt.userId = $userId AND s.id IN stmt.spaceIds
    
    WITH s, count(stmt) as statementCount
    RETURN s, statementCount
  `;

  const result = await runQuery(query, { spaceId, userId });
  if (result.length === 0) {
    return null;
  }

  const spaceData = result[0].get("s").properties;
  const statementCount = result[0].get("statementCount") || 0;

  return {
    uuid: spaceData.uuid,
    name: spaceData.name,
    description: spaceData.description,
    userId: spaceData.userId,
    createdAt: new Date(spaceData.createdAt),
    updatedAt: new Date(spaceData.updatedAt),
    isActive: spaceData.isActive,
    statementCount: Number(statementCount),
  };
}

/**
 * Update a space
 */
export async function updateSpace(
  spaceId: string,
  updates: { name?: string; description?: string },
  userId: string,
): Promise<SpaceNode> {
  const setClause = [];
  const params: any = { spaceId, userId };

  if (updates.name !== undefined) {
    setClause.push("s.name = $name");
    params.name = updates.name;
  }

  if (updates.description !== undefined) {
    setClause.push("s.description = $description");
    params.description = updates.description;
  }

  if (setClause.length === 0) {
    throw new Error("No updates provided");
  }

  setClause.push("s.updatedAt = datetime()");

  const query = `
    MATCH (s:Space {uuid: $spaceId, userId: $userId})
    WHERE s.isActive = true
    SET ${setClause.join(", ")}
    RETURN s
  `;

  const result = await runQuery(query, params);
  if (result.length === 0) {
    throw new Error("Space not found or access denied");
  }

  const spaceData = result[0].get("s").properties;
  return {
    uuid: spaceData.uuid,
    name: spaceData.name,
    description: spaceData.description,
    userId: spaceData.userId,
    createdAt: new Date(spaceData.createdAt),
    updatedAt: new Date(spaceData.updatedAt),
    isActive: spaceData.isActive,
  };
}

/**
 * Delete a space and clean up all statement references
 */
export async function deleteSpace(
  spaceId: string,
  userId: string,
): Promise<SpaceDeletionResult> {
  try {
    // 1. Check if space exists and belongs to user
    const spaceExists = await getSpace(spaceId, userId);
    if (!spaceExists) {
      return { deleted: false, statementsUpdated: 0, error: "Space not found" };
    }

    // 2. Clean up statement references (remove spaceId from spaceIds arrays)
    const cleanupQuery = `
      MATCH (s:Statement)
      WHERE s.userId = $userId AND $spaceId IN s.spaceIds
      SET s.spaceIds = [id IN s.spaceIds WHERE id <> $spaceId]
      RETURN count(s) as updatedStatements
    `;

    const cleanupResult = await runQuery(cleanupQuery, { userId, spaceId });
    const updatedStatements = cleanupResult[0]?.get("updatedStatements") || 0;

    // 3. Delete the space node
    const deleteQuery = `
      MATCH (space:Space {uuid: $spaceId, userId: $userId})
      DELETE space
      RETURN count(space) as deletedSpaces
    `;

    await runQuery(deleteQuery, { userId, spaceId });

    return {
      deleted: true,
      statementsUpdated: Number(updatedStatements),
    };
  } catch (error) {
    return {
      deleted: false,
      statementsUpdated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Assign statements to a space
 */
export async function assignStatementsToSpace(
  statementIds: string[],
  spaceId: string,
  userId: string,
): Promise<SpaceAssignmentResult> {
  try {
    // Verify space exists and belongs to user
    const space = await getSpace(spaceId, userId);
    if (!space) {
      return {
        success: false,
        statementsUpdated: 0,
        error: "Space not found or access denied",
      };
    }

    const query = `
      MATCH (s:Statement)
      WHERE s.uuid IN $statementIds AND s.userId = $userId
      SET s.spaceIds = CASE 
        WHEN s.spaceIds IS NULL THEN [$spaceId]
        WHEN $spaceId IN s.spaceIds THEN s.spaceIds
        ELSE s.spaceIds + [$spaceId]
      END,
      s.lastSpaceAssignment = datetime(),
      s.spaceAssignmentMethod = CASE 
        WHEN s.spaceAssignmentMethod IS NULL THEN 'manual'
        ELSE s.spaceAssignmentMethod
      END
      RETURN count(s) as updated
    `;

    const result = await runQuery(query, { statementIds, spaceId, userId });
    const updatedCount = result[0]?.get("updated") || 0;

    return {
      success: true,
      statementsUpdated: Number(updatedCount),
    };
  } catch (error) {
    return {
      success: false,
      statementsUpdated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove statements from a space
 */
export async function removeStatementsFromSpace(
  statementIds: string[],
  spaceId: string,
  userId: string,
): Promise<SpaceAssignmentResult> {
  try {
    const query = `
      MATCH (s:Statement)
      WHERE s.uuid IN $statementIds AND s.userId = $userId AND $spaceId IN s.spaceIds
      SET s.spaceIds = [id IN s.spaceIds WHERE id <> $spaceId]
      RETURN count(s) as updated
    `;

    const result = await runQuery(query, { statementIds, spaceId, userId });
    const updatedCount = result[0]?.get("updated") || 0;

    return {
      success: true,
      statementsUpdated: Number(updatedCount),
    };
  } catch (error) {
    return {
      success: false,
      statementsUpdated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get all statements in a space
 */
export async function getSpaceStatements(spaceId: string, userId: string) {
  const query = `
    MATCH (s:Statement)
    WHERE s.userId = $userId AND s.spaceIds IS NOT NULL AND $spaceId IN s.spaceIds
    MATCH (s)-[:HAS_SUBJECT]->(subj:Entity)
    MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
    MATCH (s)-[:HAS_OBJECT]->(obj:Entity)
    RETURN s, subj.name as subject, pred.name as predicate, obj.name as object
    ORDER BY s.createdAt DESC
  `;

  const result = await runQuery(query, { spaceId, userId });

  return result.map((record) => {
    const statement = record.get("s").properties;
    return {
      uuid: statement.uuid,
      fact: statement.fact,
      subject: record.get("subject"),
      predicate: record.get("predicate"),
      object: record.get("object"),
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt
        ? new Date(statement.invalidAt)
        : undefined,
      spaceIds: statement.spaceIds || [],
      recallCount: statement.recallCount,
    };
  });
}

/**
 * Get real-time statement count for a space from Neo4j
 */
export async function getSpaceStatementCount(
  spaceId: string,
  userId: string,
): Promise<number> {
  const query = `
    MATCH (s:Statement)
    WHERE s.userId = $userId 
      AND s.spaceIds IS NOT NULL 
      AND $spaceId IN s.spaceIds 
      AND s.invalidAt IS NULL
    RETURN count(s) as statementCount
  `;

  const result = await runQuery(query, { spaceId, userId });
  return Number(result[0]?.get("statementCount") || 0);
}

/**
 * Check if a space should trigger pattern analysis based on growth thresholds
 */
export async function shouldTriggerSpacePattern(
  spaceId: string,
  userId: string,
): Promise<{
  shouldTrigger: boolean;
  isNewSpace: boolean;
  currentCount: number;
}> {
  try {
    // Get current statement count from Neo4j
    const currentCount = await getSpaceStatementCount(spaceId, userId);

    // Get space data from PostgreSQL
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        lastPatternTrigger: true,
        statementCountAtLastTrigger: true,
      },
    });

    if (!space) {
      logger.warn(`Space ${spaceId} not found when checking pattern trigger`);
      return { shouldTrigger: false, isNewSpace: false, currentCount };
    }

    const isNewSpace = !space.lastPatternTrigger;
    const previousCount = space.statementCountAtLastTrigger || 0;
    const growth = currentCount - previousCount;

    // Trigger if: new space OR growth >= 100 statements
    const shouldTrigger = isNewSpace || growth >= 100;

    logger.info(`Space pattern trigger check`, {
      spaceId,
      currentCount,
      previousCount,
      growth,
      isNewSpace,
      shouldTrigger,
    });

    return { shouldTrigger, isNewSpace, currentCount };
  } catch (error) {
    logger.error(`Error checking space pattern trigger:`, {
      error,
      spaceId,
      userId,
    });
    return { shouldTrigger: false, isNewSpace: false, currentCount: 0 };
  }
}

/**
 * Atomically update pattern trigger timestamp and statement count to prevent race conditions
 */
export async function atomicUpdatePatternTrigger(
  spaceId: string,
  currentCount: number,
): Promise<{ updated: boolean; isNewSpace: boolean } | null> {
  try {
    // Use a transaction to atomically check and update
    const result = await prisma.$transaction(async (tx) => {
      // Get current state
      const space = await tx.space.findUnique({
        where: { id: spaceId },
        select: {
          lastPatternTrigger: true,
          statementCountAtLastTrigger: true,
        },
      });

      if (!space) {
        throw new Error(`Space ${spaceId} not found`);
      }

      const isNewSpace = !space.lastPatternTrigger;
      const previousCount = space.statementCountAtLastTrigger || 0;
      const growth = currentCount - previousCount;

      // Double-check if we still need to trigger (race condition protection)
      const shouldTrigger = isNewSpace || growth >= 100;

      if (!shouldTrigger) {
        return { updated: false, isNewSpace: false };
      }

      // Update the trigger timestamp and count atomically
      await tx.space.update({
        where: { id: spaceId },
        data: {
          lastPatternTrigger: new Date(),
          statementCountAtLastTrigger: currentCount,
        },
      });

      logger.info(`Atomically updated pattern trigger for space`, {
        spaceId,
        previousCount,
        currentCount,
        growth,
        isNewSpace,
      });

      return { updated: true, isNewSpace };
    });

    return result;
  } catch (error) {
    logger.error(`Error in atomic pattern trigger update:`, {
      error,
      spaceId,
      currentCount,
    });
    return null;
  }
}

/**
 * Initialize spaceIds array for existing statements (migration helper)
 */
export async function initializeStatementSpaceIds(
  userId?: string,
): Promise<number> {
  const query = userId
    ? `
      MATCH (s:Statement {userId: $userId})
      WHERE s.spaceIds IS NULL
      SET s.spaceIds = []
      RETURN count(s) as updated
    `
    : `
      MATCH (s:Statement)
      WHERE s.spaceIds IS NULL
      SET s.spaceIds = []
      RETURN count(s) as updated
    `;

  const result = await runQuery(query, userId ? { userId } : {});
  return Number(result[0]?.get("updated") || 0);
}

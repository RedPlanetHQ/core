import { Prisma } from "@prisma/client";

import { ProviderFactory } from "@core/providers";
import { prisma } from "~/trigger/utils/prisma";

const MIGRATION_KEY = "userWorkspaceMigrationCompleted";

export const migration = async () => {
  // Find all workspaces that have a userId set
  const allWorkspaces = await prisma.workspace.findMany({
    where: {
      userId: {
        not: null,
      },
    },
    select: {
      id: true,
      userId: true,
      metadata: true,
    },
  });

  const workspacesNeedingMigration = allWorkspaces.filter((workspace) => {
    const metadata = workspace.metadata as Record<string, any>;
    return !metadata || metadata[MIGRATION_KEY] !== true;
  });

  if (workspacesNeedingMigration.length === 0) {
    console.log("No workspaces need UserWorkspace migration.");
    return;
  }

  console.log(
    `Found ${workspacesNeedingMigration.length} workspaces that need UserWorkspace records`,
  );

  // Filter out workspaces that already have UserWorkspace records
  const workspaceIds = workspacesNeedingMigration.map((w) => w.id);
  const existingUserWorkspaces = await prisma.userWorkspace.findMany({
    where: {
      workspaceId: {
        in: workspaceIds,
      },
    },
    select: {
      workspaceId: true,
      userId: true,
    },
  });

  const existingMap = new Set(
    existingUserWorkspaces.map((uw) => `${uw.workspaceId}:${uw.userId}`),
  );

  const workspacesToMigrate = workspacesNeedingMigration.filter(
    (w) => !existingMap.has(`${w.id}:${w.userId}`),
  );

  if (workspacesToMigrate.length === 0) {
    console.log(
      "All workspaces already have UserWorkspace records. Updating metadata...",
    );
    await updateWorkspaceMetadata(workspaceIds);
    return;
  }

  console.log(
    `Creating UserWorkspace records for ${workspacesToMigrate.length} workspaces...`,
  );

  // Create UserWorkspace records in batches using transaction
  const batchSize = 100;
  let createdCount = 0;

  for (let i = 0; i < workspacesToMigrate.length; i += batchSize) {
    const batch = workspacesToMigrate.slice(i, i + batchSize);
    const batchWorkspaceIds = batch.map((w) => w.id);

    await prisma.$transaction(async (tx) => {
      // Create UserWorkspace records
      await tx.userWorkspace.createMany({
        data: batch.map((workspace) => ({
          userId: workspace.userId!,
          workspaceId: workspace.id,
          role: "OWNER",
          acceptedAt: new Date(),
          isActive: true,
        })),
        skipDuplicates: true,
      });

      // Update workspace metadata using efficient JSON merge
      await tx.$executeRaw`
        UPDATE "Workspace"
        SET metadata = metadata || ${JSON.stringify({ [MIGRATION_KEY]: true })}::jsonb
        WHERE id = ANY(${batchWorkspaceIds}::text[])
      `;
    });

    createdCount += batch.length;
    console.log(
      `Progress: ${createdCount}/${workspacesToMigrate.length} workspaces migrated`,
    );
  }

  console.log(
    `Migration complete! Created ${createdCount} UserWorkspace records and updated metadata.`,
  );

  // Build user-workspace mapping from all workspaces
  const userWorkspaceMap = allWorkspaces
    .filter((w) => w.userId)
    .map((w) => ({
      userId: w.userId!,
      workspaceId: w.id,
    }));

  // Populate workspaceId in embedding tables
  await populateEmbeddingWorkspaceIds(userWorkspaceMap);

  // Populate workspaceId in graph nodes
  await populateGraphWorkspaceIds(userWorkspaceMap);
};

async function updateWorkspaceMetadata(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return;

  // Use raw SQL with PostgreSQL's JSON merge operator for efficient bulk update
  await prisma.$executeRaw`
    UPDATE "Workspace"
    SET metadata = metadata || ${JSON.stringify({ [MIGRATION_KEY]: true })}::jsonb
    WHERE id = ANY(${workspaceIds}::text[])
  `;

  console.log(`Updated metadata for ${workspaceIds.length} workspaces.`);
}

export async function populateEmbeddingWorkspaceIds(
  userWorkspaceMap: Array<{ userId: string; workspaceId: string }>,
) {
  if (userWorkspaceMap.length === 0) {
    console.log("No user-workspace mappings found.");
    return;
  }

  console.log("Populating workspaceId in embedding tables...");
  console.log(`Found ${userWorkspaceMap.length} user-workspace mappings`);

  let totalEpisodes = 0;
  let totalStatements = 0;
  let totalEntities = 0;

  // Process in batches to avoid transaction timeouts
  const batchSize = 5;
  for (let i = 0; i < userWorkspaceMap.length; i += batchSize) {
    const batch = userWorkspaceMap.slice(i, i + batchSize);

    // Build CASE statement for this batch
    const userIds = batch.map((uw) => uw.userId);
    const caseStatements = batch
      .map((uw) => `WHEN "userId" = '${uw.userId}' THEN '${uw.workspaceId}'`)
      .join(" ");

    // Format userIds as a SQL array literal
    const userIdArray = `ARRAY[${userIds.map((id) => `'${id}'`).join(",")}]::text[]`;

    // Update EpisodeEmbedding
    const episodeResult = await prisma.$executeRawUnsafe(
      `UPDATE "episode_embeddings" SET "workspaceId" = CASE ${caseStatements} END WHERE "userId" = ANY(${userIdArray}) AND "workspaceId" IS NULL`,
    );
    totalEpisodes += Number(episodeResult);

    // Update StatementEmbedding
    const statementResult = await prisma.$executeRawUnsafe(
      `UPDATE "statement_embeddings" SET "workspaceId" = CASE ${caseStatements} END WHERE "userId" = ANY(${userIdArray}) AND "workspaceId" IS NULL`,
    );
    totalStatements += Number(statementResult);

    // Update EntityEmbedding
    const entityResult = await prisma.$executeRawUnsafe(
      `UPDATE "entity_embeddings" SET "workspaceId" = CASE ${caseStatements} END WHERE "userId" = ANY(${userIdArray}) AND "workspaceId" IS NULL`,
    );
    totalEntities += Number(entityResult);

    console.log(
      `Progress: ${Math.min(i + batchSize, userWorkspaceMap.length)}/${userWorkspaceMap.length} users processed`,
    );
  }

  console.log(`Updated ${totalEpisodes} EpisodeEmbedding records`);
  console.log(`Updated ${totalStatements} StatementEmbedding records`);
  console.log(`Updated ${totalEntities} EntityEmbedding records`);
  console.log("Embedding workspaceId population complete!");
}

export async function populateGraphWorkspaceIds(
  userWorkspaceMap: Array<{ userId: string; workspaceId: string }>,
) {
  if (userWorkspaceMap.length === 0) {
    console.log("No user-workspace mappings found for graph migration.");
    return;
  }

  console.log("Populating workspaceId in Neo4j graph nodes...");
  console.log(`Found ${userWorkspaceMap.length} user-workspace mappings`);

  try {
    const graphProvider = ProviderFactory.getGraphProvider() as any;

    let totalUpdated = 0;

    // Process in batches to avoid overwhelming Neo4j
    const batchSize = 100;
    for (let i = 0; i < userWorkspaceMap.length; i += batchSize) {
      const batch = userWorkspaceMap.slice(i, i + batchSize);

      for (const { userId, workspaceId } of batch) {
        // Update Episode nodes
        const episodeQuery = `
          MATCH (e:Episode {userId: $userId})
          WHERE e.workspaceId IS NULL
          SET e.workspaceId = $workspaceId
          RETURN count(e) as count
        `;
        const episodeResult = await graphProvider.runQuery(episodeQuery, {
          userId,
          workspaceId,
        });
        const episodeCount = episodeResult[0]?.get("count")?.toNumber() || 0;

        // Update Statement nodes
        const statementQuery = `
          MATCH (s:Statement {userId: $userId})
          WHERE s.workspaceId IS NULL
          SET s.workspaceId = $workspaceId
          RETURN count(s) as count
        `;
        const statementResult = await graphProvider.runQuery(statementQuery, {
          userId,
          workspaceId,
        });
        const statementCount =
          statementResult[0]?.get("count")?.toNumber() || 0;

        // Update Entity nodes
        const entityQuery = `
          MATCH (e:Entity {userId: $userId})
          WHERE e.workspaceId IS NULL
          SET e.workspaceId = $workspaceId
          RETURN count(e) as count
        `;
        const entityResult = await graphProvider.runQuery(entityQuery, {
          userId,
          workspaceId,
        });
        const entityCount = entityResult[0]?.get("count")?.toNumber() || 0;

        // Update HAS_PROVENANCE relationships
        const provenanceQuery = `
          MATCH ()-[r:HAS_PROVENANCE {userId: $userId}]->()
          WHERE r.workspaceId IS NULL
          SET r.workspaceId = $workspaceId
          RETURN count(r) as count
        `;
        const provenanceResult = await graphProvider.runQuery(provenanceQuery, {
          userId,
          workspaceId,
        });
        const provenanceCount =
          provenanceResult[0]?.get("count")?.toNumber() || 0;

        // Update HAS_SUBJECT relationships
        const subjectQuery = `
          MATCH ()-[r:HAS_SUBJECT {userId: $userId}]->()
          WHERE r.workspaceId IS NULL
          SET r.workspaceId = $workspaceId
          RETURN count(r) as count
        `;
        const subjectResult = await graphProvider.runQuery(subjectQuery, {
          userId,
          workspaceId,
        });
        const subjectCount = subjectResult[0]?.get("count")?.toNumber() || 0;

        // Update HAS_PREDICATE relationships
        const predicateQuery = `
          MATCH ()-[r:HAS_PREDICATE {userId: $userId}]->()
          WHERE r.workspaceId IS NULL
          SET r.workspaceId = $workspaceId
          RETURN count(r) as count
        `;
        const predicateResult = await graphProvider.runQuery(predicateQuery, {
          userId,
          workspaceId,
        });
        const predicateCount =
          predicateResult[0]?.get("count")?.toNumber() || 0;

        // Update HAS_OBJECT relationships
        const objectQuery = `
          MATCH ()-[r:HAS_OBJECT {userId: $userId}]->()
          WHERE r.workspaceId IS NULL
          SET r.workspaceId = $workspaceId
          RETURN count(r) as count
        `;
        const objectResult = await graphProvider.runQuery(objectQuery, {
          userId,
          workspaceId,
        });
        const objectCount = objectResult[0]?.get("count")?.toNumber() || 0;

        const nodeCount = episodeCount + statementCount + entityCount;
        const relationshipCount =
          provenanceCount + subjectCount + predicateCount + objectCount;
        const userTotal = nodeCount + relationshipCount;
        totalUpdated += userTotal;

        if (userTotal > 0) {
          console.log(
            `User ${userId}: ${nodeCount} nodes (${episodeCount} episodes, ${statementCount} statements, ${entityCount} entities), ${relationshipCount} relationships`,
          );
        }
      }

      console.log(
        `Progress: ${Math.min(i + batchSize, userWorkspaceMap.length)}/${userWorkspaceMap.length} users processed`,
      );
    }

    console.log(
      `Graph workspaceId population complete! Updated ${totalUpdated} total nodes.`,
    );
  } catch (error) {
    console.error("Error populating graph workspaceIds:", error);
    throw error;
  }
}

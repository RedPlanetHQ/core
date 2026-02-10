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

async function populateEmbeddingWorkspaceIds(
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

    await prisma.$transaction(async (tx) => {
      // Update EpisodeEmbedding
      const episodeResult = await tx.$executeRaw`
        UPDATE "episode_embeddings"
        SET "workspaceId" = CASE ${Prisma.raw(caseStatements)} END
        WHERE "userId" = ANY(${userIds}::text[])
          AND "workspaceId" IS NULL
      `;
      totalEpisodes += Number(episodeResult);

      // Update StatementEmbedding
      const statementResult = await tx.$executeRaw`
        UPDATE "statement_embeddings"
        SET "workspaceId" = CASE ${Prisma.raw(caseStatements)} END
        WHERE "userId" = ANY(${userIds}::text[])
          AND "workspaceId" IS NULL
      `;
      totalStatements += Number(statementResult);

      // Update EntityEmbedding
      const entityResult = await tx.$executeRaw`
        UPDATE "entity_embeddings"
        SET "workspaceId" = CASE ${Prisma.raw(caseStatements)} END
        WHERE "userId" = ANY(${userIds}::text[])
          AND "workspaceId" IS NULL
      `;
      totalEntities += Number(entityResult);
    });

    console.log(
      `Progress: ${Math.min(i + batchSize, userWorkspaceMap.length)}/${userWorkspaceMap.length} users processed`,
    );
  }

  console.log(`Updated ${totalEpisodes} EpisodeEmbedding records`);
  console.log(`Updated ${totalStatements} StatementEmbedding records`);
  console.log(`Updated ${totalEntities} EntityEmbedding records`);
  console.log("Embedding workspaceId population complete!");
}

async function populateGraphWorkspaceIds(
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

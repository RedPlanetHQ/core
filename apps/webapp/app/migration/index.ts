import { prisma } from "~/db.server";
import { runQuery } from "~/trigger/utils/provider";
import { migrateEmbeddingsTask } from "./embedding-migration";

export const migration = async () => {
  // Check if there are any workspaces that need migration (V1 -> V2)
  const workspacesNeedingMigration = await prisma.workspace.findMany({
    where: {
      version: "V1",
    },
    include: {
      user: true,
    },
  });

  if (workspacesNeedingMigration.length === 0) {
    console.log("No workspaces need migration. All are at V2 or higher.");
    return;
  }

  console.log(
    `Found ${workspacesNeedingMigration.length} workspaces to migrate from V1 to V2`,
  );

  let workspaceCount = 0;
  for await (const workspace of workspacesNeedingMigration) {
    const user = workspace?.user as any;
    let i = 0;

    await prisma.ingestionQueue.updateMany({
      where: {
        type: null,
      },
      data: {
        type: "CONVERSATION",
      },
    });

    await prisma.$executeRaw`
      UPDATE "IngestionQueue"   
      SET "sessionId" = gen_random_uuid()::text
      WHERE "sessionId" IS NULL;
    `;

    const ingestionQueues = await prisma.ingestionQueue.findMany({
      where: {
        workspaceId: workspace.id,
        status: "COMPLETED",
      },
    });

    for await (const iq of ingestionQueues) {
      let episodeUuids = [];
      if (iq.type === "CONVERSATION") {
        const episodeUUID = (iq.output as any)?.episodeUuid;

        if (!episodeUUID) {
          const outputEpisodes = (iq.output as any)?.episodes || [];
          episodeUuids = outputEpisodes.map((ep: any) => ep.episodeUuid);
        } else {
          episodeUuids = [episodeUUID];
        }
      }

      if (iq.type === "DOCUMENT") {
        const outputEpisodes = (iq.output as any)?.episodes || [];
        episodeUuids = outputEpisodes.map((ep: any) => ep.episodeUuid);
      }

      if (episodeUuids.length > 0) {
        const query = `
      MATCH (e:Episode {userId: $userId})
      WHERE e.uuid IN $episodeUuids
      SET e.sessionId = $sessionId, e.queueId = $queueId
      RETURN count(e) as updatedEpisodes
    `;

        const result = await runQuery(query, {
          userId: user.id,
          episodeUuids,
          sessionId: iq.sessionId,
          queueId: iq.id,
        });

        const count = result[0]?.get("updatedEpisodes") || 0;
        i = i + count.low;
      }
    }

    await migrateEmbeddingsTask({
      userId: user.id,
    });

    // Update workspace version to V2 after successful migration
    await prisma.workspace.update({
      where: {
        id: workspace.id,
      },
      data: {
        version: "V2",
      },
    });

    console.log(
      `Migrated workspace ${workspace.id} to V2. Total episodes updated: ${i} for user: ${user.name} - ${user.id}`,
    );
    workspaceCount++;
    console.log(
      `Progress: ${workspaceCount}/${workspacesNeedingMigration.length} workspaces migrated`,
    );
  }

  console.log(
    `Migration complete! ${workspaceCount} workspaces migrated to V2.`,
  );
};

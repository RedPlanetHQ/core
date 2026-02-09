import { prisma } from "~/db.server";

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

  // Filter workspaces that haven't been migrated yet
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

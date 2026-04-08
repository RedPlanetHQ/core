import { prisma } from "~/db.server";
import { DEFAULT_SKILL_DEFINITIONS } from "~/services/skills.defaults";

const DEFAULT_SKILLS_MIGRATION_KEY = "defaultSkillsV1Seeded";

async function migrateDefaultSkills() {
  const allWorkspaces = await prisma.workspace.findMany({
    select: { id: true, metadata: true },
  });

  const workspacesNeedingMigration = allWorkspaces.filter((workspace) => {
    const metadata = workspace.metadata as Record<string, any>;
    return !metadata?.[DEFAULT_SKILLS_MIGRATION_KEY];
  });

  if (workspacesNeedingMigration.length === 0) {
    console.log("No workspaces need default skill seeding.");
    return;
  }

  console.log(`Seeding default skills for ${workspacesNeedingMigration.length} workspaces...`);

  const workspaceIds = workspacesNeedingMigration.map((w) => w.id);
  const defaultTitles = DEFAULT_SKILL_DEFINITIONS.map((s) => s.title);

  // Find which default skills already exist per workspace
  const existingSkills = await prisma.document.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      type: "skill",
      title: { in: defaultTitles },
      deleted: null,
    },
    select: { workspaceId: true, title: true },
  });

  const existingSet = new Set(existingSkills.map((s) => `${s.workspaceId}:${s.title}`));

  // Get owner userId for each workspace (needed for editedBy)
  const userWorkspaces = await prisma.userWorkspace.findMany({
    where: { workspaceId: { in: workspaceIds }, isActive: true },
    select: { workspaceId: true, userId: true },
    orderBy: { createdAt: "asc" },
  });

  const ownerMap = new Map<string, string>();
  for (const uw of userWorkspaces) {
    if (!ownerMap.has(uw.workspaceId)) {
      ownerMap.set(uw.workspaceId, uw.userId);
    }
  }

  let created = 0;

  for (const workspace of workspacesNeedingMigration) {
    const userId = ownerMap.get(workspace.id);
    if (!userId) continue;

    const toCreate = DEFAULT_SKILL_DEFINITIONS.filter(
      (def) => !existingSet.has(`${workspace.id}:${def.title}`),
    );

    if (toCreate.length > 0) {
      await prisma.document.createMany({
        data: toCreate.map((def) => ({
          workspaceId: workspace.id,
          type: "skill",
          title: def.title,
          content: def.content,
          source: "system",
          labelIds: [],
          metadata: {
            skillType: def.skillType,
            shortDescription: def.shortDescription,
          },
          editedBy: userId,
        })),
        skipDuplicates: true,
      });
      created += toCreate.length;
    }
  }

  // Mark workspaces as migrated
  await prisma.$executeRaw`
    UPDATE "Workspace"
    SET metadata = metadata || ${JSON.stringify({ [DEFAULT_SKILLS_MIGRATION_KEY]: true })}::jsonb
    WHERE id = ANY(${workspaceIds}::text[])
  `;

  console.log(`Default skills migration complete! Created ${created} skill documents.`);
}

export const migration = async () => {
  await migrateDefaultSkills();
};

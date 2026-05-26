/**
 * Backfill: Morning Brief task + Watch Rules refresh for existing workspaces.
 *
 * New workspaces get the Morning Brief scheduled task + updated Watch Rules
 * skill automatically via `createWorkspace`. This script applies the same
 * to a list of EXISTING workspaces.
 *
 * Two operations:
 *   1. seedMorningBriefForWorkspaces — for each workspaceId:
 *        - Ensure the "Morning Brief" Document (skill) exists
 *        - Create a daily 9am scheduled task pointing at it (idempotent —
 *          skips if a task with metadata.kind="morning_brief_daily" already
 *          exists for that workspace)
 *
 *   2. replaceWatchRulesForWorkspaces — for each workspaceId:
 *        - Delete the existing "Watch Rules" Document (any row with
 *          metadata.skillType="watch-rules")
 *        - Recreate it with the current content from skills.defaults.ts
 *        - The new content includes the "Task suggestions" rule and the
 *          "Memory ingest" rule that the latest skill ships with.
 *
 * Usage:
 *   tsx apps/webapp/app/scripts/backfill-morning-brief.ts
 *
 * Either edit WORKSPACE_IDS below, or pass them via env:
 *   WORKSPACE_IDS=ws_1,ws_2,ws_3 tsx apps/webapp/app/scripts/backfill-morning-brief.ts
 *
 * Pass MODE=morning to run only morning-brief seeding; MODE=watch to run only
 * Watch Rules refresh; MODE=both (default) to do both.
 */

import { prisma } from "~/db.server";
import { DEFAULT_SKILL_DEFINITIONS } from "~/services/skills.defaults";
import { createSkill } from "~/services/skills.server";
import { createScheduledTask } from "~/services/task.server";
import { logger } from "~/services/logger.service";

// -- EDIT ME -----------------------------------------------------------------
// Hard-code workspace IDs here, or pass via WORKSPACE_IDS env var (comma-sep).
const WORKSPACE_IDS: string[] = [
  // "ws_xxx",
  // "ws_yyy",
];
// ----------------------------------------------------------------------------

interface BackfillResult {
  workspaceId: string;
  status: "seeded" | "skipped" | "failed";
  reason?: string;
}

/**
 * For each workspace: ensure the Morning Brief skill exists, then create a
 * daily 9am scheduled task pointing at it. Idempotent — re-running this is
 * safe.
 */
export async function seedMorningBriefForWorkspaces(
  workspaceIds: string[],
): Promise<BackfillResult[]> {
  const morningBriefDef = DEFAULT_SKILL_DEFINITIONS.find(
    (d) => d.skillType === "morning-brief",
  );
  if (!morningBriefDef) {
    throw new Error(
      "Morning Brief skill definition not found in DEFAULT_SKILL_DEFINITIONS. " +
        "Was skills.defaults.ts modified?",
    );
  }

  const results: BackfillResult[] = [];

  for (const workspaceId of workspaceIds) {
    try {
      // 1) Owner user — needed for skill + task creation.
      const ownerMembership = await prisma.userWorkspace.findFirst({
        where: { workspaceId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      if (!ownerMembership) {
        results.push({
          workspaceId,
          status: "failed",
          reason: "no active UserWorkspace membership",
        });
        continue;
      }
      const userId = ownerMembership.userId;

      // 2) Ensure the Morning Brief skill exists for this workspace.
      let skill = await prisma.document.findFirst({
        where: {
          workspaceId,
          type: "skill",
          deleted: null,
          metadata: { path: ["skillType"], equals: "morning-brief" },
        },
        select: { id: true, title: true },
      });

      if (!skill) {
        const created = await createSkill(workspaceId, userId, {
          title: morningBriefDef.title,
          content: morningBriefDef.content,
          source: "system",
          metadata: {
            skillType: morningBriefDef.skillType,
            shortDescription: morningBriefDef.shortDescription,
          },
        });
        skill = { id: created.id, title: created.title };
      }

      // 3) Skip if a daily morning brief task already exists for this workspace.
      const existing = await prisma.task.findFirst({
        where: {
          workspaceId,
          metadata: { path: ["kind"], equals: "morning_brief_daily" },
        },
        select: { id: true },
      });
      if (existing) {
        results.push({
          workspaceId,
          status: "skipped",
          reason: `morning brief task already exists (id=${existing.id})`,
        });
        continue;
      }

      // 4) Create the daily 9am scheduled task.
      const task = await createScheduledTask(workspaceId, userId, {
        title: "Morning brief",
        schedule: "FREQ=DAILY;BYHOUR=9",
        maxOccurrences: null,
        metadata: {
          skillId: skill.id,
          skillName: skill.title,
          kind: "morning_brief_daily",
        },
      });

      results.push({
        workspaceId,
        status: "seeded",
        reason: `task id=${task.id}`,
      });
      logger.info(
        `[backfill-morning-brief] Seeded morning brief task for ${workspaceId} (task=${task.id})`,
      );
    } catch (err) {
      results.push({
        workspaceId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error(
        `[backfill-morning-brief] Failed for ${workspaceId}: ${err}`,
      );
    }
  }

  return results;
}

/**
 * For each workspace: delete the existing Watch Rules skill (so any stale
 * version-1 content is removed), then recreate it from
 * DEFAULT_SKILL_DEFINITIONS so it picks up the latest content (including the
 * "Task suggestions" rule and the "Memory ingest" routing rule).
 *
 * Hard-deletes the old row (not soft-delete) so the new row doesn't collide
 * with anything via title-uniqueness checks elsewhere.
 */
export async function replaceWatchRulesForWorkspaces(
  workspaceIds: string[],
): Promise<BackfillResult[]> {
  const watchRulesDef = DEFAULT_SKILL_DEFINITIONS.find(
    (d) => d.skillType === "watch-rules",
  );
  if (!watchRulesDef) {
    throw new Error(
      "Watch Rules skill definition not found in DEFAULT_SKILL_DEFINITIONS.",
    );
  }

  const results: BackfillResult[] = [];

  for (const workspaceId of workspaceIds) {
    try {
      const ownerMembership = await prisma.userWorkspace.findFirst({
        where: { workspaceId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      if (!ownerMembership) {
        results.push({
          workspaceId,
          status: "failed",
          reason: "no active UserWorkspace membership",
        });
        continue;
      }
      const userId = ownerMembership.userId;

      // 1) Delete any existing Watch Rules rows for this workspace
      //    (skillType match, regardless of title — covers older renames).
      const deleteResult = await prisma.document.deleteMany({
        where: {
          workspaceId,
          type: "skill",
          metadata: { path: ["skillType"], equals: "watch-rules" },
        },
      });

      // 2) Recreate with current default content.
      const created = await createSkill(workspaceId, userId, {
        title: watchRulesDef.title,
        content: watchRulesDef.content,
        source: "system",
        metadata: {
          skillType: watchRulesDef.skillType,
          shortDescription: watchRulesDef.shortDescription,
        },
      });

      results.push({
        workspaceId,
        status: "seeded",
        reason: `deleted ${deleteResult.count} old row(s), created new id=${created.id}`,
      });
      logger.info(
        `[backfill-watch-rules] Replaced Watch Rules for ${workspaceId} (deleted=${deleteResult.count}, new=${created.id})`,
      );
    } catch (err) {
      results.push({
        workspaceId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error(
        `[backfill-watch-rules] Failed for ${workspaceId}: ${err}`,
      );
    }
  }

  return results;
}

// ----- runner ---------------------------------------------------------------

function printReport(label: string, results: BackfillResult[]): void {
  const byStatus = {
    seeded: results.filter((r) => r.status === "seeded"),
    skipped: results.filter((r) => r.status === "skipped"),
    failed: results.filter((r) => r.status === "failed"),
  };
  console.log(`\n=== ${label} ===`);
  console.log(
    `  seeded:  ${byStatus.seeded.length}` +
      `  skipped: ${byStatus.skipped.length}` +
      `  failed:  ${byStatus.failed.length}`,
  );
  for (const r of byStatus.failed) {
    console.log(`  FAILED ${r.workspaceId}: ${r.reason}`);
  }
}

async function main(): Promise<void> {
  const fromEnv = process.env.WORKSPACE_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const workspaceIds = fromEnv?.length ? fromEnv : WORKSPACE_IDS;

  if (workspaceIds.length === 0) {
    console.error(
      "No workspaceIds provided. Set WORKSPACE_IDS env var or edit the constant in this file.",
    );
    process.exit(1);
  }

  const mode = (process.env.MODE ?? "both").toLowerCase();
  console.log(
    `Running mode="${mode}" for ${workspaceIds.length} workspace(s):`,
  );
  for (const id of workspaceIds) console.log(`  - ${id}`);

  if (mode === "morning" || mode === "both") {
    const r = await seedMorningBriefForWorkspaces(workspaceIds);
    printReport("morning-brief", r);
  }

  if (mode === "watch" || mode === "both") {
    const r = await replaceWatchRulesForWorkspaces(workspaceIds);
    printReport("watch-rules", r);
  }

  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Backfill script failed:", err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
}

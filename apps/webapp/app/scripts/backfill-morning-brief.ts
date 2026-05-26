/**
 * Backfill: Morning Brief task + Watch Rules refresh + legacy Read Rules
 * cleanup for existing workspaces.
 *
 * New workspaces get the Morning Brief scheduled task + updated Watch Rules
 * automatically via `createWorkspace`. This script applies the same to
 * existing workspaces and additionally deletes the legacy "Read Rules"
 * skill (which is no longer part of DEFAULT_SKILL_DEFINITIONS).
 *
 * Three operations:
 *   1. seedMorningBriefForWorkspaces — for each workspaceId:
 *        - Ensure the "Morning Brief" Document (skill) exists
 *        - Create a daily 9am scheduled task pointing at it (idempotent —
 *          skips if a task with metadata.kind="morning_brief_daily" already
 *          exists for that workspace)
 *
 *   2. replaceWatchRulesForWorkspaces — for each workspaceId:
 *        - Hard-delete existing Watch Rules Document(s)
 *        - Recreate from current DEFAULT_SKILL_DEFINITIONS so the latest
 *          content (Task suggestions + Memory ingest rules) lands in place.
 *
 *   3. deleteReadRulesForWorkspaces — for each workspaceId:
 *        - Hard-delete any "Read Rules" skill rows (matched by title or
 *          metadata.skillType in (read-rules, read_rules)).
 *
 * Usage:
 *   tsx apps/webapp/app/scripts/backfill-morning-brief.ts
 *
 * Workspace ID resolution:
 *   - Morning brief: requires explicit IDs (curated rollout).
 *   - Watch Rules + Read Rules: default to ALL workspaces.
 *
 *   Pass via env:
 *     WORKSPACE_IDS=ws_1,ws_2 tsx apps/webapp/app/scripts/backfill-morning-brief.ts
 *
 *   Or hard-code at WORKSPACE_IDS below.
 *
 * Mode selection (MODE env, default "both"):
 *   MODE=morning       — only morning-brief seeding
 *   MODE=watch         — only Watch Rules refresh
 *   MODE=read          — only delete legacy Read Rules
 *   MODE=both          — morning + watch (legacy default)
 *   MODE=all           — all three
 *   MODE=watch,read    — comma-separated combinations are accepted
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
  "acb2f980-4442-4720-b8f9-be83f8520b2f",
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
      logger.error(`[backfill-watch-rules] Failed for ${workspaceId}: ${err}`);
    }
  }

  return results;
}

/**
 * Hard-delete the legacy "Read Rules" skill for each workspace. The skill
 * is no longer part of DEFAULT_SKILL_DEFINITIONS — its responsibilities were
 * folded into the updated Watch Rules. Match is on title (case-insensitive)
 * plus an optional metadata.skillType variant, in case older seeders used
 * either spelling.
 */
export async function deleteReadRulesForWorkspaces(
  workspaceIds: string[],
): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];

  for (const workspaceId of workspaceIds) {
    try {
      const deleteResult = await prisma.document.deleteMany({
        where: {
          workspaceId,
          type: "skill",
          OR: [
            { title: { equals: "Reading Guide", mode: "insensitive" } },
            { metadata: { path: ["skillType"], equals: "read-rules" } },
            { metadata: { path: ["skillType"], equals: "read_rules" } },
          ],
        },
      });

      if (deleteResult.count === 0) {
        results.push({
          workspaceId,
          status: "skipped",
          reason: "no Read Rules skill found",
        });
      } else {
        results.push({
          workspaceId,
          status: "seeded",
          reason: `deleted ${deleteResult.count} Read Rules row(s)`,
        });
        logger.info(
          `[backfill-read-rules] Deleted ${deleteResult.count} Read Rules row(s) for ${workspaceId}`,
        );
      }
    } catch (err) {
      results.push({
        workspaceId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error(`[backfill-read-rules] Failed for ${workspaceId}: ${err}`);
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

/**
 * Resolve which workspace IDs to operate on for a given step.
 *
 *   ALL_WORKSPACES=1 → pull every workspace.id from the DB
 *   otherwise        → use WORKSPACE_IDS env (comma-sep) or hard-coded constant
 *
 * The morning brief task uses the explicit list (creating a 9am task for
 * every user might be undesirable — the user wanted a curated rollout).
 * Watch Rules + Read Rules are "for everyone" by spec, so they default to
 * ALL_WORKSPACES when no explicit list is set.
 */
async function resolveWorkspaceIds(
  preferAllWhenEmpty: boolean,
): Promise<string[]> {
  const fromEnv = process.env.WORKSPACE_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  if (WORKSPACE_IDS.length > 0) return WORKSPACE_IDS;

  if (process.env.ALL_WORKSPACES === "1" || preferAllWhenEmpty) {
    const rows = await prisma.workspace.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }
  return [];
}

export async function backrunMain(): Promise<void> {
  const modeRaw = (process.env.MODE ?? "all").toLowerCase();
  // Accept comma-separated multi-mode too: MODE=watch,read
  const modeBits = new Set(modeRaw.split(",").map((s) => s.trim()));
  const runMorning =
    modeBits.has("morning") || modeBits.has("both") || modeBits.has("all");
  const runWatch =
    modeBits.has("watch") || modeBits.has("both") || modeBits.has("all");
  const runRead = modeBits.has("read") || modeBits.has("all");

  // Morning brief: explicit IDs only (no auto-all). Watch + Read: default to
  // all workspaces if no explicit list.
  const morningIds = runMorning ? await resolveWorkspaceIds(false) : [];
  const watchReadIds =
    runWatch || runRead ? await resolveWorkspaceIds(true) : [];

  console.log(`Running mode="${modeRaw}"`);

  if (runMorning) {
    if (morningIds.length === 0) {
      console.error(
        "MODE includes 'morning' but no workspaceIds provided. " +
          "Set WORKSPACE_IDS env var or edit the constant in this file.",
      );
      process.exit(1);
    }
    console.log(`  morning brief → ${morningIds.length} workspace(s)`);
    const r = await seedMorningBriefForWorkspaces(morningIds);
    printReport("morning-brief", r);
  }

  if (runWatch) {
    console.log(`  watch rules   → ${watchReadIds.length} workspace(s)`);
    const r = await replaceWatchRulesForWorkspaces(watchReadIds);
    printReport("watch-rules", r);
  }

  if (runRead) {
    console.log(`  read rules    → ${watchReadIds.length} workspace(s)`);
    const r = await deleteReadRulesForWorkspaces(watchReadIds);
    printReport("read-rules", r);
  }

  await prisma.$disconnect();
}

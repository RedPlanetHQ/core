/**
 * Default widget IRs — seeded as kind=DEFAULT rows.
 *
 * These serve two purposes:
 *  1. Working examples the agent can read via `get_widget` to understand the IR shape
 *     before authoring its own widget.
 *  2. Templates the user can install — the agent clones a DEFAULT into a USER
 *     widget when asked.
 *
 * Each IR is validated at seed time so a malformed default fails loudly.
 */

import type { WidgetIR } from "@core/types";
import { validateWidget } from "./validate";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type { Prisma } from "@prisma/client";

// ─── Default 1: Daily quote (AI text) ───────────────────────────────────────

const dailyQuote: WidgetIR = {
  version: 1,
  id: "daily-quote",
  title: "Daily quote",
  description: "A short daily quote refreshed each morning.",
  icon: "quote",
  config: [
    {
      id: "theme",
      type: "string",
      label: "Theme",
      placeholder: "engineering, stoicism, focus, …",
      default: "engineering",
    },
  ],
  requests: [
    {
      id: "quote",
      type: "ai.text",
      prompt:
        "Give me one short quote (max 30 words) about {{$config.theme}}. No author attribution.",
      maxTokens: 80,
      cache: { kind: "cron", cron: "0 6 * * *" },
      refresh: { kind: "onMount" },
    },
  ],
  blocks: [
    {
      id: "card",
      type: "Card",
      children: [
        {
          id: "text",
          type: "Markdown",
          source: "{{$request.quote}}",
        },
      ],
    },
  ],
};

// ─── Default 2: Important things (AI structured) ────────────────────────────

const importantThings: WidgetIR = {
  version: 1,
  id: "important-things",
  title: "Today's important things",
  description:
    "AI-curated list of the most important things from your recent activity, ranked by priority.",
  icon: "alert-triangle",
  state: [
    { id: "dismissed", type: "array", default: [], persist: true },
  ],
  requests: [
    {
      id: "items",
      type: "ai.structured",
      prompt:
        "From the user's recent activity, list today's most important items. Be terse. Max 5.",
      schema: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "priority", "why"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            why: { type: "string", maxLength: 80 },
          },
        },
      },
      cache: { kind: "ttl", ttlSeconds: 600 },
      refresh: { kind: "onVisible" },
    },
  ],
  actions: [
    {
      id: "dismiss",
      do: [
        {
          op: "mutateState",
          state: "dismissed",
          mutation: "append",
          value: "{{args.id}}",
        },
      ],
    },
  ],
  blocks: [
    {
      id: "list",
      type: "List",
      data: "{{$request.items}}",
      item: {
        title: "{{title}}",
        subtitle: "{{why}}",
        badge: "{{priority}}",
        badgeColor:
          "{{priority | match:P0=red,P1=orange,P2=yellow,P3=gray}}",
        onClick: "dismiss",
        args: { id: "{{id}}" },
      },
      emptyText: "Nothing important right now — caught up!",
    },
  ],
};

// ─── Default 3: Task manager (declarative CRUD with modal) ──────────────────
//
// v0-compatible: avoids `OR`/`AND`/ternary/`filter:` predicate grammar that
// the runtime doesn't yet implement. Filter tabs are deliberately omitted —
// they'll land when the expression evaluator grows compound predicates.
// Uses the runtime's built-in `{{uuid}}` getter for new task ids.

const taskManager: WidgetIR = {
  version: 1,
  id: "tasks",
  title: "Tasks",
  description: "Lightweight per-user task list with add, edit, complete, delete.",
  icon: "check-square",
  state: [
    { id: "tasks", type: "array", persist: true, default: [] },
    { id: "editingId", type: "string", default: "" },
    { id: "draft", type: "object", default: {} },
  ],
  actions: [
    {
      id: "addTask",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "append",
          value: { id: "{{uuid}}", title: "New task", done: false },
        },
      ],
    },
    {
      id: "openEdit",
      do: [
        { op: "setState", state: "editingId", value: "{{args.id}}" },
        { op: "openModal", block: "editModal" },
      ],
    },
    {
      id: "toggleDone",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "patch_where",
          where: "{{item.id == args.id}}",
          value: { done: "{{!item.done}}" },
        },
      ],
    },
    {
      id: "saveTask",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "patch_where",
          where: "{{item.id == $state.editingId}}",
          value: "{{$state.draft}}",
        },
        { op: "closeModal", block: "editModal" },
        { op: "setState", state: "editingId", value: "" },
      ],
    },
    {
      id: "deleteTask",
      confirm: "Delete this task?",
      do: [
        {
          op: "mutateState",
          state: "tasks",
          mutation: "remove_where",
          where: "{{item.id == $state.editingId}}",
        },
        { op: "closeModal", block: "editModal" },
        { op: "setState", state: "editingId", value: "" },
      ],
    },
  ],
  blocks: [
    {
      id: "header",
      type: "Container",
      layout: "row",
      gap: 8,
      children: [
        {
          id: "addBtn",
          type: "Button",
          label: "Add task",
          variant: "primary",
          onClick: "addTask",
        },
      ],
    },
    {
      id: "list",
      type: "List",
      data: "{{$state.tasks}}",
      item: {
        title: "{{title}}",
        badge: "{{done | match:true=done,_=open}}",
        badgeColor: "{{done | match:true=green,_=gray}}",
        onClick: "openEdit",
        args: { id: "{{id}}" },
      },
      emptyText: "No tasks. Click Add task to start.",
    },
    {
      id: "editModal",
      type: "Modal",
      open: "editingId",
      title: "Edit task",
      children: [
        {
          id: "form",
          type: "Form",
          bind: "draft",
          fields: [
            { id: "title", type: "text", label: "Title", required: true },
            { id: "done", type: "boolean", label: "Done" },
          ],
          submitLabel: "Save",
          onSubmit: "saveTask",
        },
        {
          id: "deleteBtn",
          type: "Button",
          label: "Delete",
          variant: "danger",
          onClick: "deleteTask",
        },
      ],
    },
  ],
};

export const DEFAULT_WIDGETS: WidgetIR[] = [
  dailyQuote,
  importantThings,
  taskManager,
];

/**
 * Idempotent seeder — upserts each DEFAULT_WIDGETS entry into the Widget
 * table with kind=DEFAULT, workspaceId/userId both NULL.
 *
 * Safe to call on every server boot. Use the `force` flag to overwrite the
 * spec/version when iterating on default authoring.
 */
export async function seedDefaultWidgets(
  options: { force?: boolean } = {},
): Promise<{ created: number; updated: number; skipped: number; invalid: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const widget of DEFAULT_WIDGETS) {
    // Validate inside the seeder so a malformed default doesn't crash module
    // import. Skip-and-log is preferable to crashing the webapp at boot.
    const validation = validateWidget(widget);
    if (!validation.ok) {
      invalid++;
      logger.warn(`Default widget "${widget.id}" failed validation`, {
        issues: validation.issues,
      });
      continue;
    }

    // DEFAULT rows have workspaceId=NULL, userId=NULL. Postgres treats NULLs as
    // distinct in the (workspaceId, userId, slug) unique index — so concurrent
    // seeders could both findFirst-miss and both create. The lazy-seed promise
    // lock prevents this within a single process; the per-row try/catch below
    // is the multi-process safety net (one wins, others skip on conflict).
    const existing = await prisma.widget.findFirst({
      where: { slug: widget.id, kind: "DEFAULT", deleted: null },
    });

    if (!existing) {
      try {
        await prisma.widget.create({
          data: {
            slug: widget.id,
            name: widget.title,
            description: widget.description ?? null,
            icon: widget.icon ?? null,
            kind: "DEFAULT",
            spec: widget as unknown as Prisma.InputJsonValue,
            version: widget.version,
            userId: null,
            workspaceId: null,
          },
        });
        created++;
      } catch (err) {
        // P2002 = unique constraint violation. Another process beat us; skip.
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: string }).code === "P2002"
        ) {
          skipped++;
        } else {
          throw err;
        }
      }
      continue;
    }

    if (options.force) {
      await prisma.widget.update({
        where: { id: existing.id },
        data: {
          name: widget.title,
          description: widget.description ?? null,
          icon: widget.icon ?? null,
          spec: widget as unknown as Prisma.InputJsonValue,
          version: widget.version,
        },
      });
      updated++;
    } else {
      skipped++;
    }
  }

  logger.info("seedDefaultWidgets", { created, updated, skipped, invalid });
  return { created, updated, skipped, invalid };
}

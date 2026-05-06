/**
 * Widget tools — let the CORE agent author/edit/list declarative widgets.
 *
 *   list_widgets   — discover defaults + the user's existing custom widgets.
 *   get_widget     — read a specific widget's IR (so the agent can fork or learn from it).
 *   create_widget  — validate a candidate IR and persist it as a USER widget.
 *   delete_widget  — soft-delete a USER widget.
 *
 * All tools are scoped to (workspaceId, userId). Defaults are visible across
 * workspaces but not editable.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { logger } from "~/services/logger.service";
import {
  createUserWidget,
  deleteWidget,
  getWidgetById,
  getWidgetBySlug,
  listWidgets,
} from "~/services/widgets/widget.server";
import {
  validateWidget,
  formatIssues,
} from "~/services/widgets/validate";

interface GetWidgetToolsParams {
  workspaceId: string;
  userId: string;
}

export function getWidgetTools(
  params: GetWidgetToolsParams,
): Record<string, Tool> {
  const { workspaceId, userId } = params;

  return {
    list_widgets: tool({
      description:
        "List the declarative widgets available to the current user. Returns USER widgets the user owns plus DEFAULT seed templates the agent can clone or learn from. Use this before creating a new widget to avoid duplicating an existing one.",
      inputSchema: z.object({}),
      execute: async () => {
        const widgets = await listWidgets(workspaceId, userId);
        return {
          widgets: widgets.map((w) => ({
            id: w.id,
            slug: w.slug,
            name: w.name,
            description: w.description,
            kind: w.kind,
            engine: w.engine,
            // Don't dump the full spec — agent should fetch via get_widget.
            blocks: w.spec ? (w.spec.blocks ?? []).length : 0,
            requests: w.spec ? (w.spec.requests ?? []).length : 0,
            // Bundled metadata (null for declarative)
            integration: w.bundled?.integrationSlug ?? null,
            bundledWidgetSlug: w.bundledWidgetSlug,
          })),
        };
      },
    }),

    get_widget: tool({
      description:
        "Read a widget's full IR by id or slug. Use this to inspect a DEFAULT before cloning, debug a USER widget the user is asking about, or read state from a persisted widget. Pass either `id` (exact uuid) or `slug` (looks up USER copy first, falls back to DEFAULT).",
      inputSchema: z.object({
        id: z.string().optional().describe("Widget uuid"),
        slug: z.string().optional().describe("Widget slug — preferred for defaults"),
      }),
      execute: async ({ id, slug }) => {
        if (!id && !slug) {
          return { error: "pass either id or slug" };
        }
        const widget = id
          ? await getWidgetById(id, workspaceId, userId)
          : await getWidgetBySlug(slug!, workspaceId, userId);
        if (!widget) return { error: "widget not found" };
        return {
          id: widget.id,
          slug: widget.slug,
          name: widget.name,
          description: widget.description,
          kind: widget.kind,
          version: widget.version,
          spec: widget.spec,
          state: widget.state,
          sourceSlug: widget.sourceSlug,
        };
      },
    }),

    create_widget: tool({
      description: `Create or replace a user widget from a declarative IR.

The IR is a JSON object validated against the WidgetIR schema (top-level: version, id, title, blocks, optional state/requests/derived/actions/config). The agent should:

  1. Call list_widgets first to check whether a similar widget already exists.
  2. If a DEFAULT covers the use case, prefer cloning it (set sourceSlug to the default's slug, override IR fields as needed). Use get_widget to read the default's IR first.
  3. Otherwise compose a fresh IR. Keep blocks within the closed primitive set: Container, Text, Heading, Markdown, Badge, Card, Button, Tabs, List, Table, Form, Modal, EmptyState.

If validation fails, the tool returns the list of issues so you can self-correct and call again. Slugs must be unique per user — re-calling with the same slug REPLACES the existing widget while preserving its persisted state.

Use this for declarative widgets only. For widgets that need custom React (drag-drop, complex animations, rich text), graduate to the bundled-integration path instead.`,
      inputSchema: z.object({
        spec: z
          .unknown()
          .describe(
            "WidgetIR JSON. Must include version: 1, id (slug), title, and at least one block.",
          ),
        sourceSlug: z
          .string()
          .optional()
          .describe(
            "If cloning a DEFAULT, set this to the default's slug. The widget remembers its origin.",
          ),
      }),
      execute: async ({ spec, sourceSlug }) => {
        try {
          const result = await createUserWidget({
            spec,
            workspaceId,
            userId,
            sourceSlug,
          });
          if (!result.ok) {
            return {
              ok: false,
              error: result.error,
              issues: result.issues ?? [],
            };
          }
          logger.info("widget created", {
            widgetId: result.widget.id,
            slug: result.widget.slug,
            userId,
            workspaceId,
          });
          return {
            ok: true,
            widget: {
              id: result.widget.id,
              slug: result.widget.slug,
              name: result.widget.name,
              description: result.widget.description,
              version: result.widget.version,
            },
            // Use slug — human-readable, agent-friendly, doesn't require
            // round-tripping a uuid that the model could mistranscribe.
            tag: `<core-widget slug="${result.widget.slug}" />`,
          };
        } catch (err) {
          logger.error("create_widget failed", { error: err });
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),

    delete_widget: tool({
      description:
        "Soft-delete a USER widget. Defaults cannot be deleted. Pass the widget id (uuid) returned by create_widget or list_widgets.",
      inputSchema: z.object({
        id: z.string().describe("Widget uuid (USER kind only)"),
      }),
      execute: async ({ id }) => {
        const result = await deleteWidget(id, workspaceId, userId);
        return result;
      },
    }),

    validate_widget: tool({
      description:
        "Dry-run validation of a widget IR without persisting. Returns the same issue list create_widget would emit on failure. Useful when iterating before committing.",
      inputSchema: z.object({
        spec: z.unknown(),
      }),
      execute: async ({ spec }) => {
        const result = validateWidget(spec);
        if (result.ok) return { ok: true };
        return {
          ok: false,
          issues: result.issues,
          summary: formatIssues(result.issues),
        };
      },
    }),
  };
}

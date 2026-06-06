/**
 * Tools for discovering inline UI widgets the agent can render in
 * chat replies. The widget catalog itself lives in
 * `~/services/widgets/registry.server.ts` — these tools are the
 * thin wrappers that expose it to the model.
 *
 *   - get_supported_widgets → terse catalog (id, title, description)
 *   - get_widget_info       → full definition for one widget
 *
 * The model is expected to call get_supported_widgets opportunistically
 * (cheap, no side effects), pick an id, call get_widget_info for the
 * prop contract, then emit:
 *
 *   <widget id="<id>" properties='{...}' />
 *
 * which the chat editor's tiptap node turns into the actual React
 * component for that id.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  getWidgetById,
  listWidgets,
} from "~/services/widgets/registry.server";

export function getSupportedWidgetsTool(): Tool {
  return tool({
    description:
      "List the inline widgets you can embed in your reply to render rich UI for the user. Each widget id can be passed to get_widget_info for its prop contract, then emitted in your message as `<widget id=\"<id>\" properties='{...}' />`. Pure lookup — no side effects.",
    inputSchema: z.object({}),
    execute: async () => {
      const widgets = listWidgets();
      return { widgets };
    },
  });
}

export function getWidgetInfoTool(): Tool {
  return tool({
    description:
      "Get the full contract for one widget by id — title, description, prop schema, a copy-pasteable example, and when-to-use guidance. Call this before emitting `<widget>` so the properties JSON matches the schema. Returns { error: 'not_found' } if the id isn't in the catalog.",
    inputSchema: z.object({
      id: z
        .string()
        .describe(
          "The widget id from get_supported_widgets (e.g. 'gateway-file-viewer').",
        ),
    }),
    execute: async ({ id }: { id: string }) => {
      const widget = getWidgetById(id);
      if (!widget) {
        return {
          error: "not_found",
          message: `No widget with id '${id}'. Call get_supported_widgets for the current catalog.`,
        };
      }
      return { widget };
    },
  });
}

/**
 * In-process catalog of UI widgets the agent can render inline in
 * chat replies. Each widget is identified by a short, stable `id`.
 * The agent learns about widgets via `get_supported_widgets` /
 * `get_widget_info`, then emits them in its reply as:
 *
 *   <widget id="<id>" properties='{...JSON...}' />
 *
 * The chat editor (tiptap, see
 * `~/components/conversation/extensions/widget-extension.tsx`)
 * recognises the tag, parses `properties`, looks the `id` up in the
 * client component map, and renders the React component for it.
 *
 * This server file is the single source of truth for the catalog
 * shape and contents. The client-side component map
 * (`./components.client.ts`) registers the matching React component
 * for each `id` here. Adding a widget = one entry here + one entry
 * there.
 */

export interface WidgetPropSpec {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  /** One-sentence purpose statement the agent sees in get_supported_widgets. */
  description: string;
  /** Schema, in plain-English form the agent can read directly. */
  props: WidgetPropSpec[];
  /**
   * A complete example string the agent can copy as a template.
   * Always uses double-quote attrs + single-quote JSON so it stays
   * valid as embedded HTML.
   */
  example: string;
  /** When to use this widget — concrete guidance. */
  usage: string;
}

const WIDGETS: WidgetDefinition[] = [
  {
    id: "gateway-file-viewer",
    title: "Gateway file viewer",
    description:
      "Inline preview + download card for a single file living on a connected gateway. Renders the file's contents (markdown, code, text) when possible, and always offers a download button.",
    props: [
      {
        name: "gatewayId",
        type: "string",
        required: true,
        description:
          "ID of the gateway the file lives on. Pull from <connected_gateways> in your context.",
      },
      {
        name: "path",
        type: "string",
        required: true,
        description:
          "Absolute path to the file on the gateway. Must resolve inside a folder registered with the `exec` scope; otherwise the gateway rejects the read.",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description:
          "Optional display label. Defaults to the file's basename.",
      },
    ],
    example: `<widget id="gateway-file-viewer" properties='{"gatewayId":"gw_abc123","path":"/Users/me/repo/README.md"}' />`,
    usage:
      "Use whenever you're about to reference a specific file on a connected gateway. Show the widget INSTEAD OF (or right after) naming the path in prose, so the user gets the actual preview + download rather than a path they have to navigate to themselves. Skip this widget if the file isn't on a gateway, the path isn't absolute, or it isn't inside an `exec`-scoped folder — the widget won't load.",
  },
];

const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** Lightweight listing for `get_supported_widgets`. */
export function listWidgets(): Array<
  Pick<WidgetDefinition, "id" | "title" | "description">
> {
  return WIDGETS.map((w) => ({
    id: w.id,
    title: w.title,
    description: w.description,
  }));
}

/** Full definition for `get_widget_info`. */
export function getWidgetById(id: string): WidgetDefinition | null {
  return WIDGETS_BY_ID.get(id) ?? null;
}

/** Used by validation in the chat extension. */
export function getWidgetIds(): string[] {
  return WIDGETS.map((w) => w.id);
}

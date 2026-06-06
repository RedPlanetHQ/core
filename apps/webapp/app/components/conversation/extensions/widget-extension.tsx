import { AlertTriangle } from "lucide-react";
import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { getWidgetComponent } from "~/services/widgets/components.client";

/**
 * Tiptap extension for inline UI widgets the agent embeds in chat
 * replies. Syntax in the streamed markdown:
 *
 *   <widget id="<widget-id>" properties='{"k":"v",...}' />
 *
 * The catalog lives in `~/services/widgets/registry.server.ts` (used
 * by `get_supported_widgets` / `get_widget_info`). The matching
 * React components live in `~/services/widgets/components.client.ts`.
 *
 * Errors are surfaced inline (unknown id / bad JSON) rather than
 * silently dropping the node — the agent gets feedback on the next
 * turn and the user sees that something was *meant* to render.
 *
 * Distinct from the integration-bundle `WidgetNode` in
 * `app/components/editor/extensions/widget-node-extension.tsx`, which
 * uses different attrs (widgetSlug / integrationAccountId / config)
 * and only loads in the page editor.
 */

interface WidgetAttrs {
  id: string | null;
  properties: string | null;
}

function ChatWidgetView({ node }: NodeViewProps) {
  const { id, properties } = node.attrs as WidgetAttrs;

  if (!id) {
    return <InlineError message="Widget missing `id` attribute." />;
  }

  const Component = getWidgetComponent(id);
  if (!Component) {
    return <InlineError message={`Unknown widget id: "${id}"`} />;
  }

  let parsedProps: Record<string, unknown> = {};
  if (properties && properties.trim().length > 0) {
    try {
      const parsed = JSON.parse(properties);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedProps = parsed as Record<string, unknown>;
      } else {
        return (
          <InlineError
            message={`Widget "${id}" — properties must be a JSON object.`}
          />
        );
      }
    } catch (err) {
      return (
        <InlineError
          message={`Widget "${id}" — could not parse properties JSON: ${
            err instanceof Error ? err.message : String(err)
          }`}
        />
      );
    }
  }

  return (
    <NodeViewWrapper className="my-2 block">
      <Component {...parsedProps} />
    </NodeViewWrapper>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <NodeViewWrapper className="my-2 block">
      <div className="bg-warning/10 text-warning border-warning/30 flex items-center gap-2 rounded border px-3 py-2 text-xs">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="break-words">{message}</span>
      </div>
    </NodeViewWrapper>
  );
}

/**
 * Note: `selectable: false` + `atom: true` keep the node out of the
 * cursor + selection paths — the chat editor is read-only anyway,
 * but this avoids surprises if it's ever embedded somewhere editable.
 */
export const ChatWidgetExtension = Node.create({
  name: "chatWidget",
  group: "block",
  atom: true,
  selectable: false,
  inline: false,
  draggable: false,

  addAttributes() {
    return {
      id: { default: null },
      properties: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "widget",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            id: el.getAttribute("id"),
            properties: el.getAttribute("properties"),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "widget",
      {
        id: (node.attrs as WidgetAttrs).id ?? "",
        properties: (node.attrs as WidgetAttrs).properties ?? "",
      },
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChatWidgetView, { stopEvent: () => true });
  },
});

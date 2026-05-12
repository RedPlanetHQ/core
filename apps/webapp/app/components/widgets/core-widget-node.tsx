/**
 * Tiptap Node for declarative IR widgets.
 *
 * Parses `<core-widget slug="…" />` (preferred) or `<core-widget id="…" />`
 * from chat HTML into an atom node that renders the widget via
 * `CoreWidgetView`. The agent emits the slug form because slugs are
 * human-readable, agent-friendly, and round-trip cleanly through the model
 * — uuids are easy to mistranscribe and meaningless to read.
 *
 * Distinct from the existing `WidgetNode`
 * (`apps/webapp/app/components/editor/extensions/widget-node-extension.tsx`)
 * which mounts bundled-integration widgets via `loadWidgetBundle()`. That
 * node is for vendor-shipped React bundles; this one is for IR widgets
 * persisted in the Widget table.
 */

import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { CoreWidgetView } from "./CoreWidgetView";

function CoreWidgetNodeView({ node }: NodeViewProps) {
  const slug = node.attrs.slug as string | null;
  const id = node.attrs.id as string | null;
  const configRaw = node.attrs.config as string | null;
  const ref = slug || id;

  if (!ref) {
    return (
      <NodeViewWrapper>
        <div className="my-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          &lt;core-widget&gt; missing required `slug` (or `id`) attribute
        </div>
      </NodeViewWrapper>
    );
  }

  // Parse the optional config JSON. Bad JSON / wrong shape is a soft fail
  // (render proceeds with no overrides). Values can be string | number |
  // boolean | null — honest typing, not the narrower string-only contract
  // we used to claim.
  let configOverride: Record<string, unknown> | undefined;
  if (configRaw) {
    try {
      const parsed = JSON.parse(configRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        configOverride = parsed as Record<string, unknown>;
      }
    } catch {
      configOverride = undefined;
    }
  }

  return (
    <NodeViewWrapper className="select-text">
      <CoreWidgetView widgetRef={ref} configOverride={configOverride} />
    </NodeViewWrapper>
  );
}

export const CoreWidgetNode = Node.create({
  name: "coreWidget",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      slug: { default: null },
      id: { default: null },
      /**
       * Optional JSON string of per-render config overrides.
       *
       * For DECLARATIVE widgets: overrides values in `config[].default`.
       * For BUNDLED widgets:    merged on top of the row's stored configValues.
       *
       * Use single-quoted attribute around double-quoted JSON:
       *   <core-widget slug="github-pr-files" config='{"prNumber":"123"}' />
       */
      config: { default: null },
    };
  },

  parseHTML() {
    return [
      // Lower-cased custom element form (what agents emit)
      { tag: "core-widget" },
      // CamelCase fallback for editor-internal serialization
      { tag: "coreWidget" },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {};
    if (node.attrs.slug) attrs.slug = String(node.attrs.slug);
    if (node.attrs.id) attrs.id = String(node.attrs.id);
    if (node.attrs.config) attrs.config = String(node.attrs.config);
    return ["core-widget", attrs];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CoreWidgetNodeView, {
      stopEvent: () => false,
    });
  },
});

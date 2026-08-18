/**
 * Tiptap `@` mention primitive for colleagues (workspace agents).
 *
 * One node type — two configurations. `ColleagueMention` is the base
 * class; the composer wraps it with a picker (`buildColleagueMentionExtension`),
 * the read renderer uses it without suggestion (`colleagueMentionReader`).
 * Both must live on the same schema so a message the user typed and a
 * message an agent emitted parse into the exact same node.
 *
 * Emits HTML shaped like:
 *
 *     <span data-type="mention"
 *           data-id="cass"
 *           data-label="Cass"
 *           class="mention">@Cass</span>
 *
 * Also *parses* two additional shapes so agent-authored replies render
 * as chips (the model doesn't have a Tiptap composer, so it emits the
 * documented XML-ish shape from the base prompt):
 *
 *   1. `<mention colleague="cass" />` — agent-emitted shape.
 *   2. `<span data-colleague="cass">…</span>` — legacy custom render.
 *   3. `<span data-type="mention" data-id="cass">…</span>` — stock composer.
 *
 * Keep the three shapes in sync with `services/agent/mentions.ts` — the
 * server's `parseMentions` accepts the same three, and any drift would
 * mean the router fires on markup the UI can't display (or vice versa).
 *
 * Suggestion list is passed in via a ref so the parent can refresh the
 * agent list (loader revalidations, workspace changes) without
 * re-mounting the editor.
 */

import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";

/** Shared node class. Extends the stock Mention with parseHTML rules for
 *  the two additional shapes agents emit; renderHTML stays on the stock
 *  span shape so a message re-serialized after edit round-trips cleanly. */
const ColleagueMention = Mention.extend({
  parseHTML() {
    return [
      {
        tag: "mention[colleague]",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          const slug = el.getAttribute("colleague") ?? "";
          return slug ? { id: slug, label: slug } : false;
        },
      },
      {
        tag: "span[data-colleague]",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          const slug = el.getAttribute("data-colleague") ?? "";
          if (!slug) return false;
          const label = el.textContent?.replace(/^@/, "") || slug;
          return { id: slug, label };
        },
      },
      { tag: 'span[data-type="mention"]' },
    ];
  },
});

const sharedHTMLAttributes = {
  class: "mention text-primary font-medium",
};

/** Read-only variant — no suggestion wiring. Used by the conversation
 *  message renderer so agent-emitted mentions display as chips. */
export const colleagueMentionReader = ColleagueMention.configure({
  HTMLAttributes: sharedHTMLAttributes,
});

/** Exported so the composer's Enter-handler can check whether the picker
 *  is open and let Tiptap's suggestion plugin claim the keypress. */
export const ColleagueMentionPluginKey = new PluginKey("colleagueMention");

export interface ColleagueSuggestion {
  /** Machine slug used as the mention id — must match Agents.handle. */
  handle: string;
  /** Human-readable name shown in the picker and as the mention label. */
  displayName: string;
}

interface ListProps {
  items: ColleagueSuggestion[];
  command: (item: { id: string; label: string }) => void;
}

const ColleagueList = forwardRef<any, ListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command({ id: item.handle, label: item.displayName });
  };

  useEffect(() => setSelectedIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }: { event: KeyboardEvent }) {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="bg-popover border-border text-muted-foreground z-50 rounded-lg border p-2 text-xs shadow-lg">
        No colleagues match
      </div>
    );
  }

  return (
    <div className="bg-popover border-border z-50 min-w-[180px] overflow-hidden rounded-lg border p-1 shadow-lg">
      {items.map((item, index) => (
        <button
          key={item.handle}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
            index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
          }`}
          onClick={() => selectItem(index)}
        >
          <span className="bg-primary/20 text-primary flex size-5 items-center justify-center rounded-full text-xs font-bold">
            {item.displayName[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="truncate">{item.displayName}</span>
          <span className="text-muted-foreground ml-auto text-xs">
            @{item.handle}
          </span>
        </button>
      ))}
    </div>
  );
});
ColleagueList.displayName = "ColleagueList";

/**
 * Build a Mention extension seeded from a colleagues ref. The ref indirection
 * matters — Tiptap holds a stable reference to the extension, so a direct
 * closure over the agent list would go stale whenever the loader
 * revalidated. Reading the ref inside `items` picks up the latest list on
 * every keystroke.
 */
export const buildColleagueMentionExtension = (
  colleaguesRef: React.MutableRefObject<ColleagueSuggestion[]>,
) =>
  ColleagueMention.configure({
    HTMLAttributes: sharedHTMLAttributes,
    suggestion: {
      pluginKey: ColleagueMentionPluginKey,
      items: ({ query }: { query: string }) => {
        const list = colleaguesRef.current ?? [];
        const q = query.toLowerCase();
        return list
          .filter(
            (c) =>
              c.handle.toLowerCase().startsWith(q) ||
              c.displayName.toLowerCase().startsWith(q),
          )
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer<any>;
        let popup: TippyInstance[];

        return {
          onStart(props: any) {
            component = new ReactRenderer(ColleagueList, {
              props,
              editor: props.editor,
            });

            popup = tippy("body", {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: "manual",
              placement: "bottom-start",
            });
          },
          onUpdate(props: any) {
            component.updateProps(props);
            popup[0]?.setProps({ getReferenceClientRect: props.clientRect });
          },
          onKeyDown(props: any) {
            if (props.event.key === "Escape") {
              popup[0]?.hide();
              return true;
            }
            return (component.ref as any)?.onKeyDown(props) ?? false;
          },
          onExit() {
            popup[0]?.destroy();
            component.destroy();
          },
        };
      },
    },
  });

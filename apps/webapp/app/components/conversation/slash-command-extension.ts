import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { MutableRefObject } from "react";

export interface SkillItem {
  id: string;
  title: string;
  slug: string;
}

export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

interface SkillListProps {
  items: SkillItem[];
  command: (item: SkillItem) => void;
}

const SkillCommandList = forwardRef<any, SkillListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

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
          if (items[selectedIndex]) command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return React.createElement(
      "div",
      {
        className:
          "bg-popover border border-border rounded-lg shadow-lg overflow-y-auto p-1 z-50 w-64 max-h-[280px]",
      },
      items.map((item, index) =>
        React.createElement(
          "button",
          {
            key: item.id,
            className: `flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors ${
              index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
            }`,
            onClick: () => command(item),
          },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "font-medium leading-none" },
              item.title,
            ),
            React.createElement(
              "div",
              { className: "text-xs text-muted-foreground mt-0.5" },
              `/${item.slug}`,
            ),
          ),
        ),
      ),
    );
  },
);
SkillCommandList.displayName = "SkillCommandList";

export const SkillSlashPluginKey = new PluginKey("skillSlashCommand");

export function createSkillSlashCommand(
  skillsRef: MutableRefObject<Array<{ id: string; title: string }>>,
) {
  return Extension.create({
    name: "skillSlashCommand",

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: SkillSlashPluginKey,
          char: "/",
          command: ({ editor, range, props }: any) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(`/${props.slug} `)
              .run();
          },
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            const DEFAULT_SKILLS = ["persona", "reading guide", "watch rules"];
            return skillsRef.current
              .filter(
                (s) =>
                  !DEFAULT_SKILLS.includes(s.title.toLowerCase()) &&
                  (s.title.toLowerCase().includes(q) ||
                    titleToSlug(s.title).includes(q.replace(/\s+/g, "-"))),
              )
              .map((s) => ({ ...s, slug: titleToSlug(s.title) }));
          },
          render: () => {
            let component: ReactRenderer<any>;
            let popup: TippyInstance[];

            return {
              onStart(props: any) {
                component = new ReactRenderer(SkillCommandList, {
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
                  placement: "top-start",
                });
              },
              onUpdate(props: any) {
                component.updateProps(props);
                popup[0]?.setProps({
                  getReferenceClientRect: props.clientRect,
                });
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
        }),
      ];
    },
  });
}

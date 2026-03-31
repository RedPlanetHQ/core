import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";

interface MentionListProps {
  items: { id: string; label: string }[];
  command: (item: { id: string; label: string }) => void;
}

const MentionList = forwardRef<any, MentionListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command(item);
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

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden p-1 z-50 min-w-[140px]">
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors ${
            index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
          }`}
          onClick={() => selectItem(index)}
        >
          <span className="size-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {item.label[0]?.toUpperCase()}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
});
MentionList.displayName = "MentionList";

export const buildMentionExtension = (butlerName: string) =>
  Mention.configure({
    HTMLAttributes: {
      class: "mention text-primary font-medium",
    },
    suggestion: {
      items: ({ query }: { query: string }) => {
        const suggestions = [{ id: "butler", label: butlerName }];
        return suggestions.filter((s) =>
          s.label.toLowerCase().startsWith(query.toLowerCase()),
        );
      },
      render: () => {
        let component: ReactRenderer<any>;
        let popup: TippyInstance[];

        return {
          onStart(props: any) {
            component = new ReactRenderer(MentionList, {
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

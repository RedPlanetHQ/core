import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";

const TaskPickerPluginKey = new PluginKey("taskPicker");
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
} from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { TaskStatusIcons } from "~/components/icon-utils";
import { getTaskStatusColor } from "~/components/ui/color-utils";
import type { TaskStatus } from "@core/database";

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
}

interface TaskPickerListProps {
  items: TaskItem[];
  command: (item: TaskItem) => void;
}

const TaskPickerList = forwardRef<any, TaskPickerListProps>(
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

    if (items.length === 0) {
      return (
        <div className="bg-popover border-border z-50 w-64 rounded-lg border p-2 shadow-lg">
          <div className="text-muted-foreground px-2 py-1 text-sm">
            No tasks found
          </div>
        </div>
      );
    }

    return (
      <div className="bg-popover border-border z-50 w-64 overflow-hidden rounded-lg border p-1 shadow-lg">
        <div className="max-h-64 overflow-y-auto">
        {items.map((item, index) => {
          const Icon = TaskStatusIcons[item.status];
          const color = getTaskStatusColor(item.status as any).color;
          return (
            <button
              key={item.id}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => command(item)}
            >
              <Icon size={16} color={color} className="shrink-0" />
              <span className="truncate">{item.title}</span>
            </button>
          );
        })}
        </div>
      </div>
    );
  },
);
TaskPickerList.displayName = "TaskPickerList";

export const TaskPickerExtension = Extension.create({
  name: "taskPicker",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: TaskPickerPluginKey,
        char: "[[",
        allowSpaces: true,
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContentAt(range.from, {
              type: "taskItem",
              attrs: { id: props.id, checked: props.status === "Completed" },
              content: [
                {
                  type: "paragraph",
                  content: props.title
                    ? [{ type: "text", text: props.title }]
                    : [],
                },
              ],
            })
            .run();
        },
        items: async ({ query }: { query: string }) => {
          try {
            const url = query
              ? `/api/v1/tasks?search=${encodeURIComponent(query)}`
              : `/api/v1/tasks`;
            const res = await fetch(url);
            return (await res.json()) as TaskItem[];
          } catch {
            return [];
          }
        },
        render: () => {
          let component: ReactRenderer<any>;
          let popup: TippyInstance[];

          return {
            onStart(props: any) {
              component = new ReactRenderer(TaskPickerList, {
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
      }),
    ];
  },
});

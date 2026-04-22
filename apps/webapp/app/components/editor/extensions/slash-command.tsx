import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";

const SlashCommandPluginKey = new PluginKey("slashCommand");
import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  Plug,
} from "lucide-react";
import type { WidgetOption } from "~/components/overview/types";

interface CommandItem {
  title: string;
  description: string;
  icon: React.ElementType;
  command: (editor: any) => void;
}

const STATIC_COMMANDS: CommandItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    icon: Type,
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large heading",
    icon: Heading1,
    command: (editor) =>
      editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: Heading2,
    command: (editor) =>
      editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: Heading3,
    command: (editor) =>
      editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: List,
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: ListOrdered,
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Task",
    description: "Checkbox task [ ]",
    icon: CheckSquare,
    command: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({ type: "taskItem", attrs: { checked: false } })
        .run(),
  },
  {
    title: "Code Block",
    description: "Code snippet",
    icon: Code2,
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

const CommandList = forwardRef<any, CommandListProps>(({ items, command }, ref) => {
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

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden p-1 z-50 w-56">
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground px-2 py-1.5">No results</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.title}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors ${
              index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
            }`}
            onClick={() => command(item)}
          >
            <item.icon size={14} className="shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium leading-none">{item.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
            </div>
          </button>
        ))
      )}
    </div>
  );
});
CommandList.displayName = "CommandList";

function makeSuggestionRender() {
  return () => {
    let component: ReactRenderer<any>;
    let popup: TippyInstance[];

    return {
      onStart(props: any) {
        component = new ReactRenderer(CommandList, {
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
  };
}

export const buildSlashCommand = (widgetOptions: WidgetOption[] = []) => {
  const widgetCommands: CommandItem[] = widgetOptions.map((opt) => ({
    title: opt.widgetName,
    description: `${opt.integrationName} widget`,
    icon: Plug,
    command: (editor: any) => {
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "widget",
            attrs: {
              widgetSlug: opt.widgetSlug,
              integrationAccountId: opt.integrationAccountId,
              config: null,
            },
          },
          { type: "paragraph" },
        ])
        .run();
    },
  }));

  const allCommands = [...STATIC_COMMANDS, ...widgetCommands];

  return Extension.create({
    name: "slashCommand",

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: SlashCommandPluginKey,
          char: "/",
          command: ({ editor, range, props }: any) => {
            props.command(editor);
            editor.chain().focus().deleteRange(range).run();
          },
          items: ({ query }: { query: string }) =>
            allCommands.filter((c) =>
              c.title.toLowerCase().includes(query.toLowerCase()),
            ),
          render: makeSuggestionRender(),
        }),
      ];
    },
  });
};

// Backward-compat export (no widgets)
export const SlashCommand = buildSlashCommand([]);

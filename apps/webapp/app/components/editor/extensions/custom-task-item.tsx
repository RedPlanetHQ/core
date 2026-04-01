import {
  Node,
  mergeAttributes,
  type KeyboardShortcutCommand,
} from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import React from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";

const CustomTaskItemComponent = ({ node, updateAttributes }: any) => {
  const checked: boolean = node.attrs.checked ?? false;

  return (
    <NodeViewWrapper as="div" className="group flex items-center gap-2 py-0.5">
      <label className="h-[16px] shrink-0" contentEditable={false}>
        <Checkbox
          className="h-4 w-4 shrink-0"
          checked={checked}
          onCheckedChange={(val) => updateAttributes({ checked: val === true })}
        />
      </label>
      <NodeViewContent
        as="div"
        className={cn(
          "h-[24px] min-w-[3px] flex-1 leading-4",
          checked &&
            "text-muted-foreground line-through decoration-[1px] opacity-60",
        )}
      />
    </NodeViewWrapper>
  );
};

/**
 * TaskItem with the same visual as AgentTaskComponent:
 * styled Checkbox + inline text, no DB integration.
 */
export const CustomTaskItem = Node.create({
  name: "taskItem",
  group: "block",
  content: "paragraph",
  defining: true,
  selectable: false,

  addOptions() {
    return { nested: false, HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (el) =>
          el.getAttribute("data-checked") === "true" ||
          (el as HTMLInputElement).checked,
        renderHTML: (attrs) => ({ "data-checked": attrs.checked }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `li[data-type="taskItem"]`, priority: 51 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    const isTaskItem = () => {
      const { $from } = this.editor.state.selection;
      let depth = $from.depth;
      while (depth > 0) {
        if ($from.node(depth).type.name === "taskItem") return true;
        depth--;
      }
      return false;
    };

    const shortcuts: Record<string, KeyboardShortcutCommand> = {
      Enter: () => {
        if (!isTaskItem()) return false;

        const { empty, $from } = this.editor.state.selection;

        // Text selected → split
        if (!empty) return this.editor.commands.splitListItem("taskItem");

        // Cursor at very start → lift out to paragraph
        if ($from.parentOffset === 0) {
          return this.editor
            .chain()
            .liftListItem("taskItem")
            .setNode("paragraph", {})
            .run();
        }

        // Middle or end → insert new taskItem after current
        return this.editor
          .chain()
          .insertContentAt($from.after(), {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph" }],
          })
          .setTextSelection($from.after() + 2)
          .run();
      },

      Backspace: () => {
        const state = this.editor.state;
        const { $from } = state.selection;
        const blockRange = $from.blockRange();
        if (!blockRange) return false;
        if (
          blockRange.start + 1 !== state.selection.from ||
          blockRange.start === 0
        )
          return false;

        const beforeSel = TextSelection.findFrom(
          state.doc.resolve(blockRange.start - 1),
          -1,
          true,
        );
        const beforeRange = beforeSel?.$from.blockRange();
        if (beforeRange?.parent.type.name !== "taskItem") return false;

        return this.editor.commands.deleteRange({
          from: beforeSel!.from,
          to: state.selection.from,
        });
      },

      "Mod-Backspace": () =>
        this.editor
          .chain()
          .liftListItem("taskItem")
          .setNode("paragraph", {})
          .run(),

      "Shift-Tab": () => this.editor.commands.liftListItem("taskItem"),
    };

    return shortcuts;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CustomTaskItemComponent);
  },
});

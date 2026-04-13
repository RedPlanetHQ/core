import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Server-safe TaskItem node — same attrs as client but no React renderer.
 */
export const CustomTaskItemServer = Node.create({
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
      id: { default: null },
      checked: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-checked") === "true",
        renderHTML: (attrs) => ({ "data-checked": attrs.checked }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "taskItem" }, { tag: 'li[data-type="taskItem"]', priority: 51 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["taskItem", mergeAttributes(HTMLAttributes), 0];
  },
});

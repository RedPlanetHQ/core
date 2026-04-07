import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Server-safe ButlerTask node — same attrs as client but no React renderer.
 * Used for generateHTML/generateJSON on the server.
 */
export const ButlerTaskExtensionServer = Node.create({
  name: "butlerTask",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="butlerTask"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "butlerTask" }),
    ];
  },
});

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
      checked: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-checked") === "true",
        renderHTML: (attrs) => ({ "data-checked": attrs.checked }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]', priority: 51 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }),
      0,
    ];
  },
});

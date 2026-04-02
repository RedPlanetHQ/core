import { Mark, mergeAttributes } from "@tiptap/core";

export const ButlerCommentMark = Mark.create({
  name: "butlerComment",

  addAttributes() {
    return {
      commentId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-butler-comment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-butler-comment": HTMLAttributes.commentId,
        class: "bg-amber-100/50 border-b-2 border-amber-400 cursor-pointer",
      }),
      0,
    ];
  },
});

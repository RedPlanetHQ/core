import { Extension, InputRule } from "@tiptap/core";

/**
 * Adds "[] " → taskList/taskItem input rule — matches Sol's exact approach:
 * wrapIn('taskList') then setNode('taskItem', { id: undefined })
 */
export const ChecklistInputRule = Extension.create({
  name: "checklistInputRule",

  addInputRules() {
    return [
      new InputRule({
        find: /^\[\] $/,
        handler: ({ state, range, chain }: any) => {
          const tr = state.tr.delete(range.from, range.to);
          const $start = tr.doc.resolve(range.from);
          const blockRange = $start.blockRange();
          if (!blockRange) return null;

          chain()
            .wrapIn("taskList")
            .setNode("taskItem", { id: undefined })
            .run();
        },
      }),
    ];
  },
});

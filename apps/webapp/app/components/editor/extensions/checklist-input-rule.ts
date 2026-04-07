import { Extension, InputRule } from "@tiptap/core";

/**
 * Adds "[] " → taskList/taskItem input rule as a standalone extension.
 * Separate from TaskList so the chain() has full editor context.
 */
export const ChecklistInputRule = Extension.create({
  name: "checklistInputRule",

  addInputRules() {
    return [
      new InputRule({
        find: /^\[\] $/,
        handler: ({ state, range, chain }: any) => {
          const $start = state.doc.resolve(range.from);
          const blockRange = $start.blockRange();
          if (!blockRange) return null;

          chain()
            .deleteRange({ from: blockRange.start, to: blockRange.end })
            .insertContentAt(blockRange.start, {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [{ type: "paragraph" }],
                },
              ],
            })
            .run();
        },
      }),
    ];
  },
});

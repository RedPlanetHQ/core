import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import React from "react";

const ButlerBlockComponent = ({ node }: any) => {
  const { conversationId, content, butlerName } = node.attrs;

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="border-l-2 border-primary/40 pl-3 bg-muted/30 rounded-r my-2 py-2 pr-2"
    >
      <div className="text-xs text-muted-foreground mb-1 font-medium">
        {butlerName ?? "butler"}
      </div>
      <div className="text-sm whitespace-pre-wrap">
        {content ?? (
          <span className="text-muted-foreground italic animate-pulse">
            thinking…
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const ButlerExtension = Node.create({
  name: "butlerBlock",
  group: "block",
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      conversationId: { default: null },
      content: { default: null },
      butlerName: { default: "butler" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="butlerBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "butlerBlock" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButlerBlockComponent);
  },
});

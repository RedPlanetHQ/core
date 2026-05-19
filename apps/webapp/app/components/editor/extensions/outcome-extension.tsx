import React, { useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";

function OutcomeNodeView({ node }: NodeViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  const isEmpty =
    node.content.size === 0 ||
    (node.childCount === 1 &&
      node.firstChild?.type.name === "paragraph" &&
      node.firstChild?.content.size === 0);
  if (isEmpty) return null;

  return (
    <NodeViewWrapper
      className="my-2 rounded-lg border border-border"
      data-type="outcome"
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 border-b border-border bg-grayAlpha-50 px-3 py-2 text-xs font-medium text-muted-foreground select-none hover:bg-grayAlpha-100"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        Outcome
      </button>
      {!collapsed && (
        <NodeViewContent className="px-3 py-2 prose prose-sm max-w-full" />
      )}
    </NodeViewWrapper>
  );
}

export const OutcomeNode = Node.create({
  name: "outcome",
  group: "block",
  content: "block+",
  defining: true,

  // Accept the legacy <output> tag too, for back-compat with pages that
  // were written before this rename. New writes render as <outcome>.
  parseHTML() {
    return [{ tag: "outcome" }, { tag: "output" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["outcome", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OutcomeNodeView);
  },
});

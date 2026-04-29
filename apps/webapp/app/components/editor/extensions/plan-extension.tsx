import React, { useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";

function PlanNodeView({ node }: NodeViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Hide if the node has no meaningful content. The underlying ProseMirror
  // node still exists — this only affects rendering, so the merge logic in
  // coding-task.server.ts can still address it by node type.
  const isEmpty =
    node.content.size === 0 ||
    (node.childCount === 1 &&
      node.firstChild?.type.name === "paragraph" &&
      node.firstChild?.content.size === 0);
  if (isEmpty) return null;

  return (
    <NodeViewWrapper
      className="my-2 rounded-lg border border-border"
      data-type="plan"
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 border-b border-border bg-grayAlpha-50 px-3 py-2 text-xs font-medium text-muted-foreground select-none hover:bg-grayAlpha-100"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        Plan
      </button>
      {!collapsed && (
        <NodeViewContent className="px-3 py-2 prose prose-sm max-w-full" />
      )}
    </NodeViewWrapper>
  );
}

export const PlanNode = Node.create({
  name: "plan",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "plan" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["plan", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlanNodeView);
  },
});

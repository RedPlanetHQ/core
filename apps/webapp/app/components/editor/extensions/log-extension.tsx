import React, { useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";

function LogNodeView({ node }: NodeViewProps) {
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
      data-type="log"
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 border-b border-border bg-grayAlpha-50 px-3 py-2 text-xs font-medium text-muted-foreground select-none hover:bg-grayAlpha-100"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        Log
      </button>
      {!collapsed && (
        <NodeViewContent className="px-3 py-2 prose prose-sm max-w-full" />
      )}
    </NodeViewWrapper>
  );
}

export const LogNode = Node.create({
  name: "log",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "log" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["log", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LogNodeView);
  },
});

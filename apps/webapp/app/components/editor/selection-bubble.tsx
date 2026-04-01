import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { SquareCheck } from "lucide-react";

interface SelectionBubbleProps {
  editor: Editor | null;
}

interface Position {
  top: number;
  left: number;
}

/**
 * Floating toolbar that appears above a text selection.
 * Positioned via ProseMirror coordsAtPos — no extra packages needed.
 */
export function SelectionBubble({ editor }: SelectionBubbleProps) {
  const [pos, setPos] = useState<Position | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setPos(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setPos({
        top: Math.min(start.top, end.top),
        left: (start.left + end.right) / 2,
      });
    };

    const hide = () => setPos(null);

    editor.on("selectionUpdate", update);
    editor.on("blur", hide);

    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  if (!pos || !editor || typeof document === "undefined") return null;

  function handleCreateTasks() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;

    // Collect text from each selected block separately
    const blocks: string[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock && node.textContent.trim()) {
        blocks.push(node.textContent.trim());
      }
    });

    if (blocks.length === 0) return;

    setPos(null);

    // Build inline content: one butlerTask chip per block
    const content = blocks.flatMap((text) => [
      { type: "butlerTask", attrs: { id: null, status: "Backlog", title: text } },
      { type: "text", text: " " },
    ]);

    editor.chain().focus().deleteSelection().insertContent(content).run();
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: pos.top - 8,
        left: pos.left,
        transform: "translate(-50%, -100%)",
        zIndex: 50,
      }}
      className="bg-popover border-border flex items-center rounded-lg border p-1 shadow-md"
    >
      <button
        className="hover:bg-accent text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
        title="Create task(s)"
        onMouseDown={(e) => {
          e.preventDefault();
          handleCreateTasks();
        }}
      >
        <SquareCheck size={14} />
      </button>
    </div>,
    document.body,
  );
}

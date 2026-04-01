import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { SquareCheck } from "lucide-react";

interface SelectionBubbleProps {
  editor: Editor | null;
  isToday: boolean;
}

interface Position {
  top: number;
  left: number;
}

export function SelectionBubble({ editor, isToday }: SelectionBubbleProps) {
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

  async function handleCreateTasks() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;

    const blocks: string[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock && node.textContent.trim()) {
        blocks.push(node.textContent.trim());
      }
    });

    if (blocks.length === 0) return;
    setPos(null);

    const taskStatus = isToday ? "Todo" : "Backlog";

    const tasks = await Promise.all(
      blocks.map((title) =>
        fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, source: "daily", status: taskStatus }),
        })
          .then((r) => {
            if (!r.ok) throw new Error(`Task creation failed: ${r.status}`);
            return r.json();
          })
          .catch((err) => {
            console.error("[selectionBubble] create failed:", err);
            return { id: null, status: taskStatus, title };
          }),
      ),
    );

    const content = {
      type: "taskList",
      content: tasks.map((task) => ({
        type: "taskItem",
        attrs: { checked: false },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "butlerTask",
                attrs: { id: task.id, status: task.status, title: task.title },
              },
            ],
          },
        ],
      })),
    };

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

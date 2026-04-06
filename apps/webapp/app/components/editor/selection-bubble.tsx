import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRevalidator } from "@remix-run/react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  ListChecks,
  SquareCheck,
} from "lucide-react";
import { cn } from "~/lib/utils";

interface SelectionBubbleProps {
  editor: Editor | null;
  parentTaskId?: string;
}

interface Position {
  top: number;
  left: number;
}

const TITLE_LIMIT = 150;

function splitTitleDescription(text: string): {
  title: string;
  description?: string;
} {
  if (text.length <= TITLE_LIMIT) return { title: text };
  const cut = text.lastIndexOf(" ", TITLE_LIMIT);
  const at = cut > 0 ? cut : TITLE_LIMIT;
  return {
    title: text.slice(0, at).trimEnd(),
    description: text.slice(at).trimStart(),
  };
}

function Divider() {
  return <div className="bg-border mx-0.5 h-4 w-px shrink-0" />;
}

function BubbleButton({
  title,
  label,
  active,
  onMouseDown,
  children,
}: {
  title: string;
  label?: string;
  active?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onMouseDown={onMouseDown}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-1 transition-colors",
        active ? "bg-accent" : "hover:bg-accent",
      )}
    >
      {children}
      {label && <span className="text-[11px] leading-none">{label}</span>}
    </button>
  );
}

export function SelectionBubble({ editor, parentTaskId }: SelectionBubbleProps) {
  const [pos, setPos] = useState<Position | null>(null);
  const [, forceRender] = useState(0);
  const { revalidate } = useRevalidator();

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
      forceRender((n) => n + 1);
    };

    const hide = () => setPos(null);

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("blur", hide);

    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  if (!pos || !editor || typeof document === "undefined") return null;

  const { from, to } = editor.state.selection;
  let listItemCount = 0;
  let hasButlerTask = false;
  let hasText = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      listItemCount++;
    }
    if (node.type.name === "butlerTask") {
      hasButlerTask = true;
    }
    if (node.isText && node.text?.trim()) {
      hasText = true;
    }
  });
  const isInList = listItemCount >= 2;
  const hasContent = hasText && !hasButlerTask;

  async function createTasksFromBlocks(
    blocks: { title: string; description?: string }[],
  ) {
    if (!editor || blocks.length === 0) return [];
    return Promise.all(
      blocks.map(({ title, description }) =>
        fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            source: "daily",
            status: "Backlog",
            ...(description && { description }),
            ...(parentTaskId && { parentTaskId }),
          }),
        })
          .then((r) => {
            if (!r.ok) throw new Error(`Task creation failed: ${r.status}`);
            return r.json();
          })
          .catch((err) => {
            console.error("[selectionBubble] create failed:", err);
            return { id: null, status: "Backlog", title };
          }),
      ),
    );
  }

  function buildTaskListContent(tasks: { id: string | null }[]) {
    return {
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
                attrs: { id: task.id },
              },
            ],
          },
        ],
      })),
    };
  }

  async function handleCreateTask() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;

    const blocks: { title: string; description?: string }[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock && node.textContent.trim()) {
        blocks.push(splitTitleDescription(node.textContent.trim()));
      }
    });

    if (blocks.length === 0) return;
    setPos(null);

    const tasks = await createTasksFromBlocks(blocks);
    const created = tasks.filter((t) => t.id !== null);
    if (created.length === 0) return;
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent(buildTaskListContent(created))
      .run();
    if (parentTaskId) revalidate();
  }

  async function handleConvertListToTasks() {
    if (!editor) return;
    const { from, to } = editor.state.selection;

    const blocks: { title: string; description?: string }[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === "listItem" && node.textContent.trim()) {
        blocks.push(splitTitleDescription(node.textContent.trim()));
      }
    });

    if (blocks.length === 0) return;
    setPos(null);

    const tasks = await createTasksFromBlocks(blocks);
    const created = tasks.filter((t) => t.id !== null);
    if (created.length === 0) return;
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent(buildTaskListContent(created))
      .run();
    if (parentTaskId) revalidate();
  }

  function cmd(e: React.MouseEvent, fn: () => void) {
    e.preventDefault();
    fn();
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
      {/* Headings */}
      <BubbleButton
        title="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleHeading({ level: 1 }).run())
        }
      >
        <Heading1 size={14} />
      </BubbleButton>
      <BubbleButton
        title="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleHeading({ level: 2 }).run())
        }
      >
        <Heading2 size={14} />
      </BubbleButton>
      <BubbleButton
        title="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleHeading({ level: 3 }).run())
        }
      >
        <Heading3 size={14} />
      </BubbleButton>

      <Divider />

      {/* Inline formatting */}
      <BubbleButton
        title="Bold"
        active={editor.isActive("bold")}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleBold().run())
        }
      >
        <Bold size={14} />
      </BubbleButton>
      <BubbleButton
        title="Italic"
        active={editor.isActive("italic")}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleItalic().run())
        }
      >
        <Italic size={14} />
      </BubbleButton>
      <BubbleButton
        title="Strikethrough"
        active={editor.isActive("strike")}
        onMouseDown={(e) =>
          cmd(e, () => editor.chain().focus().toggleStrike().run())
        }
      >
        <Strikethrough size={14} />
      </BubbleButton>

      {hasContent && <Divider />}

      {/* Context-aware task action */}
      {hasContent && isInList ? (
        <BubbleButton
          title="Convert list to tasks"
          label="Convert to tasks"
          onMouseDown={(e) => {
            e.preventDefault();
            handleConvertListToTasks();
          }}
        >
          <ListChecks size={14} />
        </BubbleButton>
      ) : hasContent ? (
        <BubbleButton
          title="Create task(s)"
          label="Create task"
          onMouseDown={(e) => {
            e.preventDefault();
            handleCreateTask();
          }}
        >
          <SquareCheck size={14} />
        </BubbleButton>
      ) : null}
    </div>,
    document.body,
  );
}

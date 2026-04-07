import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import React, { useEffect, useRef, useState } from "react";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import type { TaskStatus } from "@core/database";
import { cn } from "~/lib/utils";
import { useNavigate } from "@remix-run/react";

const ButlerTaskComponent = ({ node, updateAttributes, extension }: any) => {
  const { id } = node.attrs;
  const { isToday, parentTaskId } = extension.options;

  const [task, setTask] = useState<{
    title: string;
    status: string;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creatingRef = useRef(false);
  const navigate = useNavigate();

  // On mount with no id → create task in DB
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;

    const taskTitle = "Untitled task";
    const taskStatus = isToday ? "Todo" : "Backlog";

    fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskTitle,
        source: "daily",
        status: taskStatus,
        ...(parentTaskId && { parentTaskId }),
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Task creation failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        updateAttributes({ id: data.id });
        setTask({
          title: data.title ?? taskTitle,
          status: data.status ?? taskStatus,
        });
      })
      .catch((err) => {
        console.error("[butlerTask] create failed:", err);
        creatingRef.current = false;
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount with id → fetch to hydrate state
  useEffect(() => {
    if (!id) return;
    fetch(`/api/v1/tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setTask({
          title: data.title ?? "Untitled task",
          status: data.status ?? "Backlog",
        });
      })
      .catch(console.error);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll only when status is "Todo"
  useEffect(() => {
    if (!id || task?.status !== "Todo") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(() => {
      fetch(`/api/v1/tasks/${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status !== task?.status) {
            setTask((prev) => (prev ? { ...prev, status: data.status } : null));
          }
        })
        .catch(console.error);
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, task?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStatusChange(next: string) {
    if (!id) return;
    setTask((prev) => (prev ? { ...prev, status: next } : null));
    fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(console.error);
  }

  if (!task) {
    return (
      <NodeViewWrapper as="span" className="butler-task-inline">
        <span
          contentEditable={false}
          className="bg-grayAlpha-100 text-muted-foreground inline-flex items-center gap-1.5 rounded px-1.5 text-sm leading-tight"
        >
          ...
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="butler-task-inline">
      <span
        contentEditable={false}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-1.5",
          "bg-grayAlpha-100 hover:bg-grayAlpha-200 cursor-default",
          "text-sm leading-tight",
        )}
      >
        <TaskStatusDropdown
          value={(task.status || "Backlog") as TaskStatus}
          onChange={handleStatusChange}
          variant={TaskStatusDropdownVariant.NO_BACKGROUND}
        />
        <span
          className={cn(
            "max-w-[240px] cursor-pointer truncate",
            task.status === "Completed" &&
              "text-muted-foreground line-through decoration-[1px]",
          )}
          onMouseDown={(e) => {
            if (!id) return;
            e.preventDefault();
            navigate(`/home/tasks/${id}`);
          }}
        >
          {task.title || "Untitled task"}
        </span>
      </span>
    </NodeViewWrapper>
  );
};

const NODE_NAME = "butlerTask";

export const ButlerTaskExtension = ({
  pageId,
  isToday,
  parentTaskId,
}: {
  pageId: string;
  isToday: boolean;
  parentTaskId?: string;
}) =>
  Node.create({
    name: NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return { pageId, isToday, parentTaskId };
    },

    addAttributes() {
      return {
        id: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: `span[data-type="${NODE_NAME}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { "data-type": NODE_NAME }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ButlerTaskComponent);
    },
  });

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import React, { useEffect, useRef } from "react";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import type { TaskStatus } from "@core/database";
import { ExternalLink } from "lucide-react";
import { cn } from "~/lib/utils";

const TERMINAL = new Set(["Completed", "Blocked"]);

const ButlerTaskComponent = ({ node, updateAttributes, extension }: any) => {
  const { id, status, title } = node.attrs;
  const { pageId, isToday } = extension.options;

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creatingRef = useRef(false);

  // On mount with no id → create task in DB
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;

    const taskTitle = title || "Untitled task";
    const taskStatus = isToday ? "Todo" : "Backlog";

    fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskTitle,
        pageId,
        source: "daily",
        status: taskStatus,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Task creation failed: ${r.status}`);
        return r.json();
      })
      .then((task) => {
        updateAttributes({ id: task.id, status: task.status });
      })
      .catch((err) => {
        console.error("[butlerTask] create failed:", err);
        creatingRef.current = false; // allow retry on next mount
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll status when non-terminal
  useEffect(() => {
    if (!id || TERMINAL.has(status)) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(() => {
      fetch(`/api/v1/tasks/${id}`)
        .then((r) => r.json())
        .then((task) => {
          if (task.status !== status) {
            updateAttributes({ status: task.status });
          }
        })
        .catch(console.error);
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, status]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStatusChange(next: string) {
    if (!id) return;
    updateAttributes({ status: next });
    fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(console.error);
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
          value={(status || "Backlog") as TaskStatus}
          onChange={handleStatusChange}
          variant={TaskStatusDropdownVariant.NO_BACKGROUND}
        />
        <span
          className={cn(
            "max-w-[240px] truncate",
            status === "Completed" &&
              "text-muted-foreground line-through decoration-[1px]",
          )}
        >
          {title || "Untitled task"}
        </span>
        {id && (
          <a
            href={`/home/tasks/${id}`}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Open task"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={11} />
          </a>
        )}
      </span>
    </NodeViewWrapper>
  );
};

const NODE_NAME = "butlerTask";

export const ButlerTaskExtension = ({
  pageId,
  isToday,
}: {
  pageId: string;
  isToday: boolean;
}) =>
  Node.create({
    name: NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return { pageId, isToday };
    },

    addAttributes() {
      return {
        id: { default: null },
        status: { default: "Backlog" },
        title: { default: null },
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

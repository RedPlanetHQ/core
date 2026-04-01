import {
  Node,
  mergeAttributes,
  type KeyboardShortcutCommand,
} from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import React, { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  Backlog: "bg-muted text-muted-foreground",
  Todo: "bg-blue-100 text-blue-700",
  InProgress: "bg-yellow-100 text-yellow-700",
  Blocked: "bg-red-100 text-red-700",
  Completed: "bg-green-100 text-green-700",
};

const TERMINAL = new Set(["Completed", "Blocked"]);

const AgentTaskComponent = ({
  node,
  updateAttributes,
  extension,
  selected,
}: any) => {
  const { id, status, conversationId } = node.attrs;
  const { pageId, isToday } = extension.options;

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creatingRef = useRef(false);

  // On mount with no id → create task in DB with current text as title
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;

    const title = node.textContent?.trim() || "Untitled task";
    const taskStatus = isToday ? "Todo" : "Backlog";

    fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        pageId,
        source: "daily",
        status: taskStatus,
      }),
    })
      .then((r) => r.json())
      .then((task) => {
        updateAttributes({ id: task.id, status: task.status });
      })
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll status when we have an id and status is non-terminal
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

  function handleToggle(checked: boolean | "indeterminate") {
    if (!id) return;
    const next = checked === true ? "Completed" : "Todo";
    updateAttributes({ status: next });
    fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(console.error);
  }

  const label = STATUS_COLORS[status] ? status : "Backlog";
  const isDone = label === "Completed";

  return (
    <NodeViewWrapper className="task-item-component" as="div">
      <div className="group flex items-center gap-2 py-0.5">
        <label className="shrink-0" contentEditable={false}>
          <Checkbox
            className="h-4 w-4 shrink-0 rounded"
            checked={isDone}
            onCheckedChange={handleToggle}
          />
        </label>

        <NodeViewContent
          as="p"
          className={cn(
            "min-w-[3px] flex-1 leading-6",
            isDone &&
              "text-muted-foreground line-through decoration-[1px] opacity-60",
          )}
        />

        <div
          className="flex shrink-0 items-center gap-2"
          contentEditable={false}
        >
          {id && (
            <span
              className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-xs"
              onClick={() => {
                window.location.href = "/home/tasks";
              }}
              title="View in Tasks"
            >
              {id.slice(0, 6)}
            </span>
          )}
          {label !== "Backlog" && (
            <span
              className={cn(
                "cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium",
                STATUS_COLORS[label],
              )}
              onClick={() => {
                if (id) window.location.href = "/home/tasks";
              }}
            >
              {label}
            </span>
          )}
          {conversationId && (
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                window.location.href = `/home/conversations/${conversationId}`;
              }}
              title="View agent conversation"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

const NODE_NAME = "agentTask";

export const AgentTaskExtension = ({
  pageId,
  isToday,
}: {
  pageId: string;
  isToday: boolean;
}) =>
  Node.create({
    name: NODE_NAME,
    group: "block",
    content: "paragraph",
    selectable: true,
    defining: true,

    addOptions() {
      return { pageId, isToday };
    },

    addAttributes() {
      return {
        id: { default: null },
        status: { default: "Backlog" },
        conversationId: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${NODE_NAME}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { "data-type": NODE_NAME }),
        0,
      ];
    },

    addNodeView() {
      // Debounce map keyed by task id — persists across re-renders (Sol pattern)
      const titleDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

      return ReactNodeViewRenderer(AgentTaskComponent, {
        update: (props: any) => {
          const { newNode } = props;
          console.log(newNode);
          const taskId = newNode?.attrs?.id;

          if (taskId) {
            const title = newNode.textContent?.trim() || "Untitled task";
            const prev = titleDebounceMap.get(taskId);
            if (prev) clearTimeout(prev);
            titleDebounceMap.set(
              taskId,
              setTimeout(() => {
                titleDebounceMap.delete(taskId);
                fetch(`/api/v1/tasks/${taskId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title }),
                }).catch(console.error);
              }, 800),
            );
          }

          props.updateProps();
          return true;
        },
      } as any);
    },

    addKeyboardShortcuts() {
      const isAgentTask = () => {
        const { selection } = this.editor.state;
        let depth = selection.$from.depth;
        while (depth > 0) {
          if (selection.$from.node(depth).type.name === NODE_NAME) return true;
          depth--;
        }
        return false;
      };

      const shortcuts: Record<string, KeyboardShortcutCommand> = {
        Enter: () => {
          if (!isAgentTask()) return false;

          const { selection } = this.editor.state;
          const { empty, $from } = selection;

          if (!empty) return false;

          // At start of empty task → lift to paragraph
          if ($from.parentOffset === 0 && $from.parent.textContent === "") {
            return this.editor.chain().setNode("paragraph", {}).run();
          }

          // Insert a new agentTask after current
          return this.editor
            .chain()
            .insertContentAt($from.after(), {
              type: NODE_NAME,
              attrs: { id: null, status: "Backlog", conversationId: null },
              content: [{ type: "paragraph" }],
            })
            .setTextSelection($from.after() + 2)
            .run();
        },

        Backspace: () => {
          if (!isAgentTask()) return false;

          const state = this.editor.state;
          const { selection } = state;
          const blockRange = selection.$from.blockRange();
          if (!blockRange) return false;

          // Only act when cursor is at the very start of content
          if (blockRange.start + 1 !== selection.from) return false;

          const beforePos = TextSelection.findFrom(
            state.doc.resolve(blockRange.start - 1),
            -1,
            true,
          );
          const beforeRange = beforePos?.$from.blockRange();

          // If the node before is also an agentTask, merge
          if (beforeRange?.parent.type.name === NODE_NAME) {
            return this.editor.commands.deleteRange({
              from: beforePos!.from,
              to: selection.from,
            });
          }

          // Otherwise lift to paragraph
          return this.editor.chain().setNode("paragraph", {}).run();
        },

        "Mod-Backspace": () => {
          if (!isAgentTask()) return false;
          return this.editor.chain().setNode("paragraph", {}).run();
        },
      };

      return shortcuts;
    },

    addInputRules() {
      // [] now creates a native taskList item — no agentTask trigger
      return [];
    },
  });

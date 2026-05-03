import {
  Node,
  mergeAttributes,
  type KeyboardShortcutCommand,
} from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type ReactNodeViewRendererOptions,
} from "@tiptap/react";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@remix-run/react";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import type { TaskStatus } from "@core/database";
import { ButlerRunBadge } from "~/components/tasks/butler-run-badge";

// ── Component ────────────────────────────────────────────────────────────────

const ScratchpadTaskComponent = ({
  node,
  updateAttributes,
  extension,
  selected,
}: any) => {
  const { id } = node.attrs;
  const { parentTaskId } = extension.options ?? {};

  const [status, setStatus] = useState<TaskStatus>("Todo");
  const [taskMeta, setTaskMeta] = useState<{
    displayId: string | null;
    nextRunAt: string | null;
    isRecurring: boolean;
    maxOccurrences: number | null;
    occurrenceCount: number;
  }>({
    displayId: null,
    nextRunAt: null,
    isRecurring: false,
    maxOccurrences: null,
    occurrenceCount: 0,
  });
  const creatingRef = useRef(false);
  const navigate = useNavigate();

  const applyTaskData = useCallback((data: any) => {
    setStatus(data.status ?? "Todo");
    setTaskMeta({
      displayId: data.displayId ?? null,
      nextRunAt: data.nextRunAt ?? null,
      isRecurring: !!data.schedule,
      maxOccurrences: data.maxOccurrences ?? null,
      occurrenceCount: data.occurrenceCount ?? 0,
    });
    if (data.id) {
      extension.options._taskCache[data.id] = {
        title: data.title ?? "",
        description: data.description ?? null,
      };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No id → create task in DB on mount
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;

    fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Untitled task",
        source: "daily",
        status: "Todo",
        ...(parentTaskId ? { parentTaskId } : {}),
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Task creation failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        updateAttributes({ id: data.id });
        applyTaskData(data);
      })
      .catch((err) => {
        console.error("[scratchpadTask] create failed:", err);
        creatingRef.current = false;
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Has id → hydrate from DB
  useEffect(() => {
    if (!id) return;
    fetch(`/api/v1/tasks/${id}`)
      .then((r) => r.json())
      .then(applyTaskData)
      .catch(console.error);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStatusChange(newStatus: string) {
    if (!id) return;
    setStatus(newStatus as TaskStatus);
    fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    }).catch(console.error);
  }

  const isCompleted = status === "Done";

  // Match Sol: NodeViewWrapper as="div" — no li, no bullet dot
  return (
    <NodeViewWrapper as="div">
      <div
        className={cn(
          "hover:bg-grayAlpha-100 group -ml-2 inline-flex items-center gap-2 rounded px-2 py-0.5",
          selected && "bg-grayAlpha-300",
        )}
      >
        <label
          className="flex shrink-0 items-center py-1"
          contentEditable={false}
        >
          <Checkbox
            className="h-[18px] w-[18px] shrink-0"
            checked={isCompleted}
            onCheckedChange={(val) =>
              handleStatusChange(val === true ? "Done" : "Todo")
            }
          />
        </label>

        <NodeViewContent
          as="p"
          className={cn(
            "min-w-[3px]",
            isCompleted &&
              "decoration-muted-foreground line-through decoration-[1px] opacity-60",
          )}
        />

        {id && (
          <div
            className="flex shrink-0 items-center gap-1.5"
            contentEditable={false}
          >
            {taskMeta.displayId && (
              <span
                className="text-muted-foreground relative top-[1px] cursor-pointer font-mono text-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigate(`/home/tasks/${id}`);
                }}
              >
                {taskMeta.displayId}
              </span>
            )}
            {taskMeta.nextRunAt && (
              <ButlerRunBadge
                nextRunAt={taskMeta.nextRunAt}
                isRecurring={taskMeta.isRecurring}
              />
            )}
            {taskMeta.isRecurring &&
              taskMeta.maxOccurrences &&
              taskMeta.maxOccurrences > 1 && (
                <span className="text-muted-foreground text-xs">
                  {Math.max(
                    taskMeta.maxOccurrences - taskMeta.occurrenceCount,
                    0,
                  )}{" "}
                  left
                </span>
              )}
            <TaskStatusDropdown
              value={status}
              onChange={handleStatusChange}
              variant={TaskStatusDropdownVariant.NO_BACKGROUND}
            />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

// ── Extension ────────────────────────────────────────────────────────────────

const NODE_NAME = "taskItem";

export const ScratchpadTaskItem = ({
  pageId,
  parentTaskId,
}: {
  pageId: string;
  parentTaskId?: string;
}) =>
  Node.create({
    name: NODE_NAME,
    selectable: true,

    content() {
      return "paragraph";
    },

    defining: true,

    addOptions() {
      return {
        pageId,
        parentTaskId,
        nested: false,
        HTMLAttributes: {},
        _taskCache: {} as Record<string, { title: string; description: string | null }>,
      };
    },

    addAttributes() {
      return {
        id: { default: undefined },
      };
    },

    // Match Sol: parse/render as custom <taskItem> tag — no li, no bullet
    parseHTML() {
      return [{ tag: NODE_NAME }];
    },

    renderHTML({ HTMLAttributes }) {
      return [NODE_NAME, mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      // Per-task debounce timers for title sync — lives outside React so typing
      // never triggers a React re-render (which would move the cursor).
      const titleDebounceTimers = new Map<
        string,
        ReturnType<typeof setTimeout>
      >();

      return ReactNodeViewRenderer(ScratchpadTaskComponent, {
        as: "li",
        attrs: { "data-type": NODE_NAME } as Record<string, string>,
        update: ({ oldNode, newNode, updateProps }) => {
          // Only re-render React when attrs change (e.g. id gets assigned after
          // task creation). Content changes are managed by NodeViewContent
          // (ProseMirror-owned DOM) and must NOT trigger a React re-render —
          // doing so resets the cursor position while the user is typing.
          if (oldNode.attrs.id !== newNode.attrs.id) {
            updateProps();
          }

          // Title sync: debounced PATCH on text change, no React re-render needed.
          const id = newNode.attrs.id as string | undefined;
          if (id && oldNode.textContent !== newNode.textContent) {
            const title = newNode.textContent.trim();
            if (title) {
              const existing = titleDebounceTimers.get(id);
              if (existing) clearTimeout(existing);
              titleDebounceTimers.set(
                id,
                setTimeout(() => {
                  titleDebounceTimers.delete(id);
                  fetch(`/api/v1/tasks/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    // sourcePageId tells the server to skip propagating this
                    // title back into the originating page's live Y.Doc — that
                    // would wipe the fragment and reset the user's cursor.
                    body: JSON.stringify({ title, sourcePageId: pageId }),
                  }).catch(console.error);
                }, 500),
              );
            }
          }

          return true;
        },
      } as ReactNodeViewRendererOptions);
    },

    addKeyboardShortcuts() {
      const isTaskItem = () => {
        const { $from } = this.editor.state.selection;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === NODE_NAME) return true;
          depth--;
        }
        return false;
      };

      const shortcuts: Record<string, KeyboardShortcutCommand> = {
        Enter: () => {
          if (!isTaskItem()) return false;

          const { empty, $from } = this.editor.state.selection;

          if (!empty) return this.editor.commands.splitListItem(NODE_NAME);

          if ($from.parentOffset === 0) {
            return this.editor
              .chain()
              .liftListItem(NODE_NAME)
              .setNode("paragraph", {})
              .run();
          }

          return this.editor
            .chain()
            .insertContentAt($from.after(), {
              type: NODE_NAME,
              attrs: { id: undefined },
              content: [{ type: "paragraph" }],
            })
            .setTextSelection($from.after() + 2)
            .run();
        },

        "Shift-Tab": () => this.editor.commands.liftListItem(NODE_NAME),

        Backspace: () => {
          const state = this.editor.state;
          const { $from } = state.selection;
          const blockRange = $from.blockRange();
          if (!blockRange) return false;
          if (
            blockRange.start + 1 !== state.selection.from ||
            blockRange.start === 0
          )
            return false;

          const beforeSel = TextSelection.findFrom(
            state.doc.resolve(blockRange.start - 1),
            -1,
            true,
          );
          const beforeRange = beforeSel?.$from.blockRange();
          if (beforeRange?.parent.type.name !== NODE_NAME) return false;

          return this.editor.commands.deleteRange({
            from: beforeSel!.from,
            to: state.selection.from,
          });
        },

        "Mod-Backspace": () =>
          this.editor
            .chain()
            .liftListItem(NODE_NAME)
            .setNode("paragraph", {})
            .run(),
      };

      return shortcuts;
    },

    addProseMirrorPlugins() {
      const ext = this;
      return [
        new Plugin({
          appendTransaction(transactions, oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;

            const oldIds = new Map<string, string>();
            oldState.doc.descendants((node) => {
              if (node.type.name === NODE_NAME && node.attrs.id) {
                oldIds.set(node.attrs.id, node.textContent.trim());
              }
            });

            const newIds = new Set<string>();
            newState.doc.descendants((node) => {
              if (node.type.name === NODE_NAME && node.attrs.id) {
                newIds.add(node.attrs.id);
              }
            });

            for (const [id, textContent] of oldIds) {
              if (newIds.has(id)) continue;
              const cached = ext.options._taskCache[id];
              const isUntitled =
                textContent === "" &&
                (!cached ||
                  !cached.title ||
                  cached.title === "Untitled task");
              const hasNoDescription = !cached || !cached.description;
              if (isUntitled && hasNoDescription) {
                fetch(`/api/v1/tasks/${id}`, { method: "DELETE" }).catch(
                  console.error,
                );
              }
            }

            return null;
          },
        }),
      ];
    },
  });

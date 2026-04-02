import React, { useEffect, useRef, useState } from "react";
import { Trash2, Plus, ExternalLink, ChevronRight, ArrowUpRight, Layers } from "lucide-react";
import { TaskPageEditor } from "~/components/tasks/task-page-editor.client";
import { Tabs, TabsContent } from "~/components/ui/tabs";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  TaskConversationsSelect,
  formatRunLabel,
} from "~/components/tasks/task-conversations-select";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import { TaskInlineForm } from "~/components/tasks/task-inline-form.client";
import { PageHeader } from "~/components/common/page-header";
import type { getConversationAndHistory } from "~/services/conversation.server";
import type { TaskFull } from "~/services/task.server";
import { cn } from "~/lib/utils";
import type { TaskStatus } from "@core/database";

type ConversationItem = NonNullable<
  Awaited<ReturnType<typeof getConversationAndHistory>>
>;

interface TaskDetailFullProps {
  task: TaskFull;
  conversations: ConversationItem[];
  integrationAccountMap?: Record<string, string>;
  butlerName?: string;
  taskPageId: string;
  collabToken: string;
  isSubmitting: boolean;
  onSave: (title: string) => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  onCreateSubtask: (title: string, status: string) => void;
  onSubtaskStatusChange: (subtaskId: string, status: string) => void;
  onSubtaskDelete: (subtaskId: string) => void;
  onSubtaskClick: (id: string) => void;
}

function SubIssuesPopover({
  subtasks,
  doneCount,
  onSubtaskClick,
}: {
  subtasks: TaskFull["subtasks"];
  doneCount: number;
  onSubtaskClick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = subtasks.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="border-border text-muted-foreground hover:bg-grayAlpha-100 flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs transition-colors">
          <Layers size={11} />
          <span>
            {doneCount}/{subtasks.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-border border-b px-3 py-2">
          <input
            autoFocus
            placeholder="Search sub tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-muted-foreground w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-52 overflow-y-auto py-1">
          {filtered.map((subtask) => (
            <button
              key={subtask.id}
              className="hover:bg-grayAlpha-100 flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left"
              onClick={() => {
                onSubtaskClick(subtask.id);
                setOpen(false);
              }}
            >
              <div className="shrink-0">
                <TaskStatusDropdown
                  value={subtask.status as TaskStatus}
                  onChange={() => {}}
                  variant={TaskStatusDropdownVariant.NO_BACKGROUND}
                />
              </div>
              {subtask.displayId && (
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {subtask.displayId}
                </span>
              )}
              <span className="min-w-0 truncate text-sm">{subtask.title}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              No sub-issues found
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SubtaskRow({
  subtask,
  onStatusChange,
  onDelete,
  onClick,
}: {
  subtask: TaskFull["subtasks"][number];
  onStatusChange: (status: string) => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  return (
    <div className="hover:bg-grayAlpha-100 group flex min-w-0 items-center gap-2 px-3 py-2">
      <div className="shrink-0">
        <TaskStatusDropdown
          value={subtask.status as TaskStatus}
          onChange={onStatusChange}
          variant={TaskStatusDropdownVariant.NO_BACKGROUND}
        />
      </div>
      <span
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate text-sm",
          subtask.status === "Completed" &&
            "text-muted-foreground line-through decoration-[1px]",
        )}
        onClick={onClick}
      >
        {subtask.title}
      </span>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded"
          onClick={onClick}
        >
          <ExternalLink size={12} />
        </Button>
      </div>
    </div>
  );
}

export function TaskDetailFull({
  task,
  conversations,
  integrationAccountMap = {},
  butlerName = "Core",
  taskPageId,
  collabToken,
  isSubmitting,
  onSave,
  onDelete,
  onStatusChange,
  onCreateSubtask,
  onSubtaskStatusChange,
  onSubtaskDelete,
  onSubtaskClick,
}: TaskDetailFullProps) {
  const [title, setTitle] = React.useState(task.title);
  const [activeTab, setActiveTab] = React.useState("info");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [selectedConversationId, setSelectedConversationId] = React.useState(
    () => conversations[conversations.length - 1]?.id ?? "",
  );
  const [subtasksExpanded, setSubtasksExpanded] = useState(true);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTitleRef = useRef(task.title);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(task.title);
    lastSavedTitleRef.current = task.title;
    if (titleRef.current && titleRef.current.textContent !== task.title) {
      titleRef.current.textContent = task.title;
    }
    setSelectedConversationId(
      conversations[conversations.length - 1]?.id ?? "",
    );
  }, [task.id]);

  const handleTitleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const next = e.currentTarget.textContent ?? "";
    setTitle(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (next.trim() && next !== lastSavedTitleRef.current) {
        lastSavedTitleRef.current = next;
        onSave(next);
      }
    }, 800);
  };

  const doneSubtasks = task.subtasks.filter(
    (s) => s.status === "Completed",
  ).length;
  const totalSubtasks = task.subtasks.length;

  const truncate = (s: string, max = 24) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  const breadcrumbs = [
    { label: "Tasks", href: "/home/tasks" },
    ...(task.parentTask
      ? [
          {
            label: truncate(task.parentTask.title),
            href: `/home/tasks/${task.parentTask.id}`,
          },
        ]
      : []),
    { label: truncate(title || "Untitled") },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex h-[calc(100vh-16px)] flex-col"
    >
      <PageHeader
        title={title || "Untitled"}
        breadcrumbs={breadcrumbs}
        tabs={[
          {
            label: "Info",
            value: "info",
            isActive: activeTab === "info",
            onClick: () => setActiveTab("info"),
          },
          {
            label: "Conversations",
            value: "conversation",
            isActive: activeTab === "conversation",
            onClick: () => setActiveTab("conversation"),
          },
        ]}
        actionsNode={
          <div className="flex items-center gap-2">
            {activeTab === "conversation" && conversations.length > 1 && (
              <Select
                value={selectedConversationId}
                onValueChange={setSelectedConversationId}
              >
                <SelectTrigger className="h-7 w-auto rounded border-none bg-transparent text-xs shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {[...conversations].reverse().map((conv, i) => (
                    <SelectItem
                      key={conv.id}
                      value={conv.id}
                      className="text-xs"
                    >
                      {formatRunLabel(conv, conversations.length - 1 - i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-7 w-7 rounded"
              onClick={() => setDeleteOpen(true)}
              disabled={isSubmitting}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        }
      />

      {/* Info tab */}
      <TabsContent
        value="info"
        className="mt-0 flex flex-1 flex-col overflow-y-auto px-6 py-6"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleTitleInput}
            className="empty:before:text-muted-foreground w-full whitespace-pre-wrap break-words bg-transparent text-2xl font-semibold empty:before:font-semibold empty:before:content-['Task_title'] focus:outline-none"
          />

          {/* Properties bar */}
          <div className="flex flex-wrap items-center gap-1.5">
            {task.displayId && (
              <span className="border-border text-muted-foreground rounded border px-2 py-0.5 font-mono text-xs">
                {task.displayId}
              </span>
            )}

            <TaskStatusDropdown
              value={task.status as TaskStatus}
              onChange={onStatusChange}
              variant={TaskStatusDropdownVariant.DEFAULT}
            />

            {totalSubtasks > 0 && (
              <SubIssuesPopover
                subtasks={task.subtasks}
                doneCount={doneSubtasks}
                onSubtaskClick={onSubtaskClick}
              />
            )}

            {task.parentTask && (
              <button
                className="border-border text-muted-foreground hover:bg-grayAlpha-100 flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors"
                onClick={() => onSubtaskClick(task.parentTask!.id)}
              >
                <ArrowUpRight size={11} />
                <span className="text-muted-foreground">Parent</span>
                <span className="max-w-[140px] truncate text-foreground">
                  {task.parentTask.title}
                </span>
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Description
            </p>
            <TaskPageEditor
              pageId={taskPageId}
              collabToken={collabToken}
              butlerName={butlerName}
              taskId={task.id}
            />
          </div>

          {/* Sub-issues section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                onClick={() => setSubtasksExpanded(!subtasksExpanded)}
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    "transition-transform",
                    subtasksExpanded && "rotate-90",
                  )}
                />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Sub-issues
                </span>
                {totalSubtasks > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {doneSubtasks}/{totalSubtasks}
                  </span>
                )}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded"
                onClick={() => {
                  setSubtasksExpanded(true);
                  setShowSubtaskForm(true);
                }}
              >
                <Plus size={12} />
              </Button>
            </div>

            {subtasksExpanded && (
              <div className="flex flex-col gap-0">
                {task.subtasks.length > 0 && (
                  <div className="divide-border divide-y overflow-hidden rounded-lg border">
                    {task.subtasks.map((subtask) => (
                      <SubtaskRow
                        key={subtask.id}
                        subtask={subtask}
                        onStatusChange={(status) =>
                          onSubtaskStatusChange(subtask.id, status)
                        }
                        onDelete={() => onSubtaskDelete(subtask.id)}
                        onClick={() => onSubtaskClick(subtask.id)}
                      />
                    ))}
                  </div>
                )}

                {showSubtaskForm && (
                  <div className={cn(task.subtasks.length > 0 && "mt-2")}>
                    <TaskInlineForm
                      onSubmit={(title, _description, status) => {
                        onCreateSubtask(title, status);
                        setShowSubtaskForm(false);
                      }}
                      onCancel={() => setShowSubtaskForm(false)}
                      isSubmitting={isSubmitting}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      {/* Conversations tab */}
      <TabsContent
        value="conversation"
        className="mt-0 flex flex-1 flex-col overflow-hidden"
      >
        <TaskConversationsSelect
          conversations={conversations}
          selectedId={selectedConversationId}
          integrationAccountMap={integrationAccountMap}
          butlerName={butlerName}
        />
      </TabsContent>

      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </Tabs>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Trash2, Plus, GitFork, ExternalLink, X } from "lucide-react";
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
  TaskConversationsSelect,
  formatRunLabel,
} from "~/components/tasks/task-conversations-select";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
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
  onCreateSubtask: (title: string) => void;
  onSubtaskStatusChange: (subtaskId: string, status: string) => void;
  onSubtaskDelete: (subtaskId: string) => void;
  onSubtaskClick: (id: string) => void;
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
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1.5 hover:bg-grayAlpha-100"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="shrink-0">
        <TaskStatusDropdown
          value={subtask.status as TaskStatus}
          onChange={onStatusChange}
          variant={TaskStatusDropdownVariant.NO_BACKGROUND}
        />
      </div>
      <span
        className={cn(
          "flex-1 cursor-pointer text-sm",
          subtask.status === "Completed" &&
            "text-muted-foreground line-through decoration-[1px]",
        )}
        onClick={onClick}
      >
        {subtask.title}
      </span>
      {hovered && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded"
            onClick={onClick}
          >
            <ExternalLink size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <X size={12} />
          </Button>
        </div>
      )}
    </div>
  );
}

function SubtaskCreator({ onSubmit }: { onSubmit: (title: string) => void }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      onSubmit(value.trim());
      setValue("");
    }
    if (e.key === "Escape") {
      setValue("");
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Plus size={14} className="text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
        placeholder="Add sub-task..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {focused && value.trim() && (
        <span className="text-muted-foreground text-xs">↵ to add</span>
      )}
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTitleRef = useRef(task.title);

  useEffect(() => {
    setTitle(task.title);
    lastSavedTitleRef.current = task.title;
    setSelectedConversationId(
      conversations[conversations.length - 1]?.id ?? "",
    );
  }, [task.id]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
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

            <TaskStatusDropdown
              value={task.status as TaskStatus}
              onChange={onStatusChange}
              variant={TaskStatusDropdownVariant.DEFAULT}
            />

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded text-destructive hover:text-destructive"
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
        <div className="mx-auto w-full max-w-2xl flex flex-col gap-6">
          <input
            className="w-full bg-transparent text-2xl font-semibold focus:outline-none"
            value={title}
            onChange={handleTitleChange}
            placeholder="Task title"
          />

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

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Sub-tasks
              </p>
              {totalSubtasks > 0 && (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <GitFork size={11} />
                  {doneSubtasks}/{totalSubtasks}
                </span>
              )}
            </div>

            <div className="rounded-lg border">
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
              <SubtaskCreator onSubmit={onCreateSubtask} />
            </div>
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

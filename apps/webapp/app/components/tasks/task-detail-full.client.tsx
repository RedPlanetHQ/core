import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  ChevronRight,
  ArrowUpRight,
  Clock,
  RefreshCw,
  Bot,
} from "lucide-react";
import { formatRunTime } from "~/components/tasks/butler-run-badge";
import { TaskPageEditor } from "~/components/tasks/task-page-editor.client";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ScheduleDialog } from "~/components/tasks/schedule-dialog";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "~/components/tasks/task-status-dropdown";
import { TaskInlineForm } from "~/components/tasks/task-inline-form.client";
import {
  TaskChannelPicker,
  type ChannelOption,
} from "~/components/tasks/task-channel-picker";
import type { TaskFull } from "~/services/task.server";
import { cn } from "~/lib/utils";
import type { TaskStatus } from "@core/database";
import { SubTask } from "../icons/sub-task";

interface TaskDetailFullProps {
  task: TaskFull;
  integrationAccountMap?: Record<string, string>;
  butlerName?: string;
  taskPageId: string;
  collabToken: string;
  isSubmitting: boolean;
  channels?: ChannelOption[];
  defaultChannelName?: string | null;
  onSave: (title: string) => void;
  onStatusChange: (status: string) => void;
  onCreateSubtask: (title: string, status: string) => void;
  onSubtaskStatusChange: (subtaskId: string, status: string) => void;
  onSubtaskDelete: (subtaskId: string) => void;
  onSubtaskClick: (id: string) => void;
  onChannelChange?: (channelId: string | null) => void;
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
        <Button variant="secondary" className="gap-1">
          <SubTask size={14} />
          <span>
            {doneCount}/{subtasks.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-border border-b px-3 py-2">
          <input
            autoFocus
            placeholder="Search sub tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="flex max-h-52 flex-col items-start justify-start gap-1 overflow-y-auto p-1">
          {filtered.map((subtask) => (
            <Button
              key={subtask.id}
              variant="ghost"
              className="w-full min-w-0 justify-start gap-1"
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
            </Button>
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              No sub-tasks found
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
    <div className="hover:bg-grayAlpha-100 group flex min-w-0 items-center gap-2 rounded px-2 py-1">
      <div className="shrink-0">
        <TaskStatusDropdown
          value={subtask.status as TaskStatus}
          onChange={onStatusChange}
          variant={TaskStatusDropdownVariant.NO_BACKGROUND}
        />
      </div>
      <span
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate",
          subtask.status === "Done" &&
            "text-muted-foreground line-through decoration-[1px]",
        )}
        onClick={onClick}
      >
        {subtask.title}
      </span>
    </div>
  );
}

export function TaskDetailFull({
  task,
  integrationAccountMap = {},
  butlerName = "Core",
  taskPageId,
  collabToken,
  isSubmitting,
  channels = [],
  defaultChannelName = null,
  onSave,
  onStatusChange,
  onCreateSubtask,
  onSubtaskStatusChange,
  onSubtaskDelete,
  onSubtaskClick,
  onChannelChange,
}: TaskDetailFullProps) {
  const [title, setTitle] = React.useState(task.title);

  const [subtasksExpanded, setSubtasksExpanded] = useState(true);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTitleRef = useRef(task.title);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(task.title);
    lastSavedTitleRef.current = task.title;
    if (titleRef.current && titleRef.current.textContent !== task.title) {
      titleRef.current.textContent = task.title;
    }
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

  const doneSubtasks = task.subtasks.filter((s) => s.status === "Done").length;
  const totalSubtasks = task.subtasks.length;

  return (
    <>
      <div className="w-full overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleTitleInput}
            className="empty:before:text-muted-foreground w-full whitespace-pre-wrap break-words bg-transparent text-2xl font-semibold empty:before:font-semibold empty:before:content-['Task_title'] focus:outline-none"
          />

          {/* Properties bar */}
          <div className="bg-grayAlpha-50 flex flex-wrap items-center gap-1.5 rounded p-2">
            {task.displayId && (
              <span className="rounded px-2 py-0.5 font-mono text-sm">
                {task.displayId}
              </span>
            )}

            <TaskStatusDropdown
              value={task.status as TaskStatus}
              onChange={onStatusChange}
              variant={TaskStatusDropdownVariant.LINK}
            />


            {totalSubtasks > 0 && (
              <SubIssuesPopover
                subtasks={task.subtasks}
                doneCount={doneSubtasks}
                onSubtaskClick={onSubtaskClick}
              />
            )}

            {task.parentTask && (
              <Button
                variant="secondary"
                className="gap-1"
                onClick={() => onSubtaskClick(task.parentTask!.id)}
              >
                <ArrowUpRight size={16} />
                <span className="text-muted-foreground">Parent</span>
                <span className="text-foreground max-w-[140px] truncate">
                  {task.parentTask.title}
                </span>
              </Button>
            )}

            <Button
              variant="secondary"
              className="gap-1"
              onClick={() => setScheduleOpen(true)}
            >
              {task.isActive &&
              task.schedule &&
              (!task.maxOccurrences || task.maxOccurrences > 1) ? (
                <RefreshCw size={14} />
              ) : task.isActive && task.nextRunAt ? (
                <Bot size={14} />
              ) : (
                <Clock size={14} />
              )}
              <span>
                {task.isActive &&
                task.schedule &&
                (!task.maxOccurrences || task.maxOccurrences > 1)
                  ? ((task.metadata as Record<string, string> | null)
                      ?.scheduleText ?? "Recurring")
                  : task.isActive && task.nextRunAt
                    ? `Butler · ${formatRunTime(new Date(task.nextRunAt as unknown as string))}`
                    : "Schedule"}
                {task.isActive &&
                  task.schedule &&
                  task.maxOccurrences &&
                  task.maxOccurrences > 1 && (
                    <span className="text-muted-foreground ml-1">
                      ·{" "}
                      {Math.max(
                        task.maxOccurrences - task.occurrenceCount,
                        0,
                      )}{" "}
                      left
                    </span>
                  )}
              </span>
            </Button>

            {onChannelChange && channels.length > 0 && (
              <TaskChannelPicker
                channels={channels}
                selectedChannelId={task.channelId ?? null}
                defaultChannelName={defaultChannelName}
                onChange={onChannelChange}
              />
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

          {/* Sub-tasks section */}
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
                  Sub-tasks
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
                  <div>
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
      </div>

      {scheduleOpen && (
        <ScheduleDialog
          onClose={() => setScheduleOpen(false)}
          taskId={task.id}
        />
      )}
    </>
  );
}

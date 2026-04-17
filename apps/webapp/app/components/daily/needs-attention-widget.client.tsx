import { useState, useEffect } from "react";
import { AlertCircle, LoaderCircle, Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { Button, buttonVariants } from "../ui";

interface SubtaskItem {
  id: string;
  status: string;
  source: string;
}

interface TaskItem {
  id: string;
  title: string;
  displayId: string;
  status: string;
  source?: string | null;
  createdAt: string;
  subtasks: SubtaskItem[];
}

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "yesterday";
    } else {
      return `${diffDays}d ago`;
    }
  } catch {
    return "";
  }
}

const PRESETS = [
  { label: "30 minutes", schedule: "FREQ=MINUTELY;INTERVAL=30" },
  { label: "45 minutes", schedule: "FREQ=MINUTELY;INTERVAL=45" },
  { label: "1 hour", schedule: "FREQ=HOURLY;INTERVAL=1" },
];

interface RemindPopoverProps {
  taskId: string;
  taskTitle: string;
  onReminded: (taskId: string) => void;
}

function RemindPopover({ taskId, taskTitle, onReminded }: RemindPopoverProps) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [unit, setUnit] = useState<"minutes" | "hours" | "days" | "date">(
    "minutes",
  );
  const [amount, setAmount] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setShowCustom(false);
    setUnit("minutes");
    setAmount("");
    setDateValue("");
  };

  const remind = async (
    params: { schedule: string } | { nextRunAt: string },
  ) => {
    setLoading(true);
    try {
      await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Reminder: ${taskTitle}`,
          source: "reminder",
          parentTaskId: taskId,
          maxOccurrences: 1,
          status: "Ready",
          ...params,
        }),
      });
      // Parent stays Waiting — the widget hides it while the reminder subtask
      // is active, and re-shows it once the subtask is deleted or completes.
      onReminded(taskId);
      setOpen(false);
      reset();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (schedule: string) => remind({ schedule });

  const handleCustomSubmit = () => {
    if (unit === "date") {
      if (!dateValue) return;
      remind({ nextRunAt: new Date(dateValue).toISOString() });
    } else {
      const n = Number(amount);
      if (!n || n <= 0) return;
      const schedules = {
        minutes: `FREQ=MINUTELY;INTERVAL=${n}`,
        hours: `FREQ=HOURLY;INTERVAL=${n}`,
        days: `FREQ=DAILY;INTERVAL=${n}`,
      };
      remind({ schedule: schedules[unit] });
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1">
          <Bell size={16} />
          Remind
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        {!showCustom ? (
          <div className="flex flex-col gap-1">
            {PRESETS.map(({ label, schedule }) => (
              <button
                key={label}
                disabled={loading}
                onClick={() => handlePreset(schedule)}
                className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm disabled:opacity-50"
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setShowCustom(true)}
              className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm"
            >
              Custom…
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              {(["minutes", "hours", "days", "date"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`rounded px-2 py-0.5 text-xs capitalize ${unit === u ? "bg-muted font-medium" : "hover:bg-muted"}`}
                >
                  {u === "date" ? "Date" : u}
                </button>
              ))}
            </div>
            {unit === "date" ? (
              <input
                type="datetime-local"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"
              />
            ) : (
              <input
                type="number"
                min={1}
                placeholder={`${unit === "minutes" ? "30" : unit === "hours" ? "2" : "1"}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"
              />
            )}
            <div className="flex gap-1">
              <button
                onClick={() => setShowCustom(false)}
                className="hover:bg-muted flex-1 rounded border border-gray-200 py-1 text-xs dark:border-gray-700"
              >
                Back
              </button>
              <button
                disabled={
                  loading ||
                  (unit !== "date" && !amount) ||
                  (unit === "date" && !dateValue)
                }
                onClick={handleCustomSubmit}
                className="bg-primary text-primary-foreground flex-1 rounded py-1 text-xs disabled:opacity-50"
              >
                {loading ? "…" : "Set"}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function NeedsAttentionWidget() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = () => {
      fetch("/api/v1/tasks?status=Waiting")
        .then((r) => r.json())
        .then((data: TaskItem[]) => {
          // Exclude tasks that already have an active (non-Done) reminder subtask
          const filtered = data.filter(
            (t) =>
              !t.subtasks?.some(
                (s) => s.source === "reminder" && s.status !== "Done",
              ),
          );
          setTasks(filtered);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 30_000);
    return () => clearInterval(interval);
  }, []);

  const visible = tasks.filter((t) => !hidden.has(t.id));

  const hide = (id: string) => setHidden((p) => new Set([...p, id]));

  return (
    <div className="bg-grayAlpha-50 flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-start gap-2 px-4 py-2.5 pr-2">
        Waiting
        {visible.length > 0 && (
          <span className="bg-grayAlpha-100 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium">
            {visible.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <AlertCircle size={20} className="text-muted-foreground" />
          <p className="text-muted-foreground text-sm">All caught up!</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {visible.map((task) => (
            <div key={task.id} className="border-b">
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-snug">
                    <span className="text-muted-foreground mr-1 text-sm">
                      {task.displayId}
                    </span>{" "}
                    <span>{task.title}</span>
                  </p>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatTime(task.createdAt)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <RemindPopover
                    taskId={task.id}
                    taskTitle={task.title}
                    onReminded={hide}
                  />
                  <a
                    href={`/home/tasks/${task.id}`}
                    className={cn(buttonVariants({ variant: "secondary" }))}
                  >
                    Open
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React from "react";
import { cn } from "./utils";

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled" | string;
export type TaskPriority = "low" | "medium" | "high" | "urgent" | string;

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority?: TaskPriority;
  url?: string;
}

export interface TasksProps {
  title?: string;
  items: TaskItem[];
  emptyText?: string;
  className?: string;
}

const STATUS_DOT: Record<string, string> = {
  todo: "bg-muted-foreground/40",
  in_progress: "bg-yellow-400",
  done: "bg-green-500",
  cancelled: "bg-muted-foreground/20",
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-400",
  medium: "text-foreground",
  low: "text-muted-foreground",
};

export function Tasks({ title, items, emptyText = "No tasks", className }: TasksProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {title && (
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          {title}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className="hover:bg-muted/50 flex items-center gap-2 rounded px-1 py-1.5"
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                STATUS_DOT[item.status] ?? "bg-muted-foreground/40",
              )}
            />
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                item.status === "done" && "text-muted-foreground line-through",
                item.status === "cancelled" && "text-muted-foreground line-through",
                item.priority && PRIORITY_COLOR[item.priority],
              )}
            >
              {item.title}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

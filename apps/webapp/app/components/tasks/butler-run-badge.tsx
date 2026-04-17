import { Bot } from "lucide-react";
import { Badge } from "~/components/ui/badge";

export function formatRunTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffHours < 48) return "tomorrow";
  return `${date.toLocaleString("en", { month: "short" })} ${date.getDate()}`;
}

export function ButlerRunBadge({
  nextRunAt,
  isRecurring,
}: {
  nextRunAt: string | Date;
  isRecurring?: boolean;
}) {
  const date =
    nextRunAt instanceof Date ? nextRunAt : new Date(nextRunAt as string);
  if (date.getTime() < Date.now()) return null;
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Bot size={14} className="text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">
        Butler · <span className="text-foreground">{formatRunTime(date)}</span>
        {isRecurring && (
          <span className="text-muted-foreground"> · is recurring</span>
        )}
      </span>
    </Badge>
  );
}

import { useState } from "react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { type LogItem } from "~/hooks/use-logs";
import { LogOptions } from "./log-options";
import { LogDetails } from "./log-details";

interface LogTextCollapseProps {
  text?: string;
  error?: string;
  logData: any;
  log: LogItem;
  id: string;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "PROCESSING":
      return "bg-blue-100 text-blue-800 hover:bg-blue-100 hover:text-blue-800";
    case "PENDING":
      return "bg-yellow-100 text-yellow-800 hover:bg-yellow-100 hover:text-yellow-800";
    case "COMPLETED":
      return "bg-success/10 text-success hover:bg-success/10 hover:text-success";
    case "FAILED":
      return "bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive";
    case "CANCELLED":
      return "bg-gray-100 text-gray-800 hover:bg-gray-100 hover:text-gray-800";
    default:
      return "bg-gray-100 text-gray-800 hover:bg-gray-100 hover:text-gray-800";
  }
};

export function LogTextCollapse({
  text,
  error,
  id,
  log,
}: LogTextCollapseProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Show collapse if text is long (by word count)
  const COLLAPSE_WORD_LIMIT = 30;

  if (!text) {
    return (
      <div className="text-muted-foreground mb-2 text-xs italic">
        No log details.
      </div>
    );
  }

  // Split by words for word count
  const words = text.split(/\s+/);
  const isLong = words.length > COLLAPSE_WORD_LIMIT;

  let displayText: string;
  if (isLong) {
    displayText = words.slice(0, COLLAPSE_WORD_LIMIT).join(" ") + " ...";
  } else {
    displayText = text;
  }

  return (
    <div className="flex w-full items-center">
      <div
        className={cn(
          "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-4",
        )}
        onClick={() => setDialogOpen(true)}
      >
        <div
          className={cn(
            "border-border flex w-full min-w-[0px] shrink flex-col border-b py-1",
          )}
        >
          <div className="flex w-full items-center justify-between gap-4">
            <div className="inline-flex min-h-[24px] min-w-[0px] shrink cursor-pointer items-center justify-start">
              <div className={cn("truncate text-left")}>
                {text.replace(/<[^>]+>/g, "")}
              </div>
            </div>

            <div className="text-muted-foreground flex shrink-0 items-center justify-end text-xs">
              <div className="flex items-center">
                <Badge
                  className={cn(
                    "bg-grayAlpha-100 text-foreground mr-3 rounded text-xs",
                  )}
                >
                  {log.source}
                </Badge>
                <Badge
                  className={cn(
                    "mr-3 rounded text-xs",
                    getStatusColor(log.status),
                  )}
                >
                  {log.status.charAt(0).toUpperCase() +
                    log.status.slice(1).toLowerCase()}
                </Badge>

                <div className="text-muted-foreground mr-3">
                  {new Date(log.time).toLocaleString()}
                </div>

                <LogOptions id={id} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <LogDetails
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        text={text}
        error={error}
        log={log}
      />
    </div>
  );
}

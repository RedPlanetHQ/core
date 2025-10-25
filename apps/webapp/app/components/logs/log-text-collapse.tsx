import { cn } from "~/lib/utils";
import { Badge, BadgeColor } from "../ui/badge";
import { type LogItem } from "~/hooks/use-logs";
import { getIconForAuthorise } from "../icon-utils";
import { useNavigate, useParams } from "@remix-run/react";
import { getStatusColor, getStatusValue } from "./utils";
import { File, MessageSquare } from "lucide-react";

interface LogTextCollapseProps {
  text?: string;
  error?: string;
  logData: any;
  log: LogItem;
  id: string;
  reset?: () => void;
}

export function LogTextCollapse({ text, log }: LogTextCollapseProps) {
  const { logId } = useParams();
  const navigate = useNavigate();

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

  const showStatus = (log: LogItem) => {
    if (log.status === "COMPLETED") {
      return false;
    }

    return true;
  };

  const getIngestType = (log: LogItem) => {
    const type = log.type ?? log.data.type ?? "CONVERSATION";

    return type === "CONVERSATION" ? (
      <MessageSquare size={14} />
    ) : (
      <File size={14} />
    );
  };

  return (
    <div className="flex w-full items-center">
      <div
        className={cn(
          "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-2 text-sm",
          logId === log.id && "bg-grayAlpha-200",
        )}
        onClick={() => {
          navigate(`/home/inbox/${log.id}`);
        }}
      >
        <div className="border-border flex w-full min-w-[0px] shrink flex-col gap-1 border-b py-2">
          <div className={cn("flex w-full min-w-[0px] shrink flex-col")}>
            <div className="flex w-full items-center justify-between gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start">
                <div className={cn("truncate text-left text-base")}>
                  {text.replace(/<[^>]+>/g, "")}
                </div>
              </div>

              {showStatus(log) && (
                <div className="text-muted-foreground flex shrink-0 items-center justify-end text-xs">
                  <div className="flex items-center">
                    <Badge
                      className={cn(
                        "!bg-grayAlpha-100 text-muted-foreground rounded text-xs",
                      )}
                    >
                      <BadgeColor className={cn(getStatusColor(log.status))} />
                      {getStatusValue(log.status)}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 font-light">
              {getIconForAuthorise(log.source.toLowerCase(), 12, undefined)}
              {log.source.toLowerCase()}
            </div>

            <div className="flex items-center gap-1">
              <Badge
                className={cn(
                  "text-muted-foreground rounded !bg-transparent text-xs",
                )}
              >
                {getIngestType(log)}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

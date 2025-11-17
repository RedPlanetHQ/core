import { type ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Badge, BadgeColor } from "../ui/badge";
import { type LogItem } from "~/hooks/use-logs";
import { getIconForAuthorise } from "../icon-utils";
import { cn, formatString } from "~/lib/utils";
import { getStatusColor } from "./utils";
import { ConversationView } from "./views/conversation-view";
import { SessionConversationView } from "./views/session-conversation-view";
import { DocumentEditorView } from "./views/document-editor-view.client";
import { ClientOnly } from "remix-utils/client-only";
import { Input } from "../ui";
import { type Label, LabelDropdown } from "./label-dropdown";

interface LogDetailsProps {
  log: LogItem;
  labels: Label[];
}

interface PropertyItemProps {
  label: string;
  value?: string | ReactNode;
  icon?: ReactNode;
  variant?: "default" | "secondary" | "outline" | "status" | "ghost";
  statusColor?: string;
  className?: string;
}

function PropertyItem({
  value,
  icon,
  variant = "secondary",
  statusColor,
  className,
}: PropertyItemProps) {
  if (!value) return null;

  return (
    <div className="flex items-center py-1 !text-base">
      {variant === "status" ? (
        <Badge
          className={cn(
            "text-foreground h-7 items-center gap-2 rounded !bg-transparent px-2 !text-base",
            className,
          )}
        >
          {statusColor && (
            <BadgeColor
              className={cn("h-2.5 w-2.5")}
              style={{ backgroundColor: statusColor }}
            />
          )}
          {value}
        </Badge>
      ) : (
        <Badge
          variant={variant}
          className={cn("h-7 items-center gap-2 rounded !text-base", className)}
        >
          {icon}
          {value}
        </Badge>
      )}
    </div>
  );
}

function getStatusValue(status: string) {
  if (status === "PENDING") {
    return formatString("IN QUEUE");
  }

  return formatString(status);
}

export function LogDetails({ log, labels }: LogDetailsProps) {
  return (
    <div className="flex h-full w-full flex-col items-center overflow-auto">
      <div className="max-w-4xl min-w-3xl">
        <div>
          <Input
            value={log.title ?? "Untitled"}
            className="no-scrollbar mt-5 resize-none overflow-hidden border-0 bg-transparent px-6 py-0 text-xl font-medium outline-none focus-visible:ring-0"
          />
        </div>
        <div className="mt-5 mb-3 px-4">
          <div className="bg-grayAlpha-100 flex items-center gap-1 rounded-xl px-2 py-2">
            <PropertyItem
              label="Source"
              value={formatString(log.source?.toLowerCase())}
              icon={
                log.source &&
                getIconForAuthorise(log.source.toLowerCase(), 16, undefined)
              }
              variant="ghost"
            />

            {log.status !== "COMPLETED" && (
              <PropertyItem
                label="Status"
                value={getStatusValue(log.status)}
                variant="status"
                statusColor={log.status && getStatusColor(log.status)}
              />
            )}

            <LabelDropdown value={log.labels} labels={labels} logId={log.id} />
          </div>
        </div>

        {/* Error Details */}
        {log.error && (
          <div className="mb-6 px-4">
            <div className="bg-destructive/10 rounded-md p-3">
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-sm break-words whitespace-pre-wrap">
                  {log.error}
                </p>
              </div>
            </div>
          </div>
        )}

        <ClientOnly
          fallback={
            <div className="flex w-full justify-center">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            </div>
          }
        >
          {() => (
            <>
              {/* Conditional Views Based on Log Type and Session */}
              {log.data?.type === "CONVERSATION" && log.isSessionGroup ? (
                // View 2: Session-based conversation (show all episodes in session)
                <SessionConversationView log={log} />
              ) : log.data?.type === "CONVERSATION" ? (
                // View 1: Simple conversation (just show content)
                <ConversationView log={log} />
              ) : log.data?.type === "DOCUMENT" ? (
                // View 3: Document with tiptap editor
                <DocumentEditorView log={log} />
              ) : null}
            </>
          )}
        </ClientOnly>
      </div>
    </div>
  );
}

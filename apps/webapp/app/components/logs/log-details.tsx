import { type ReactNode, useState, useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Badge, BadgeColor } from "../ui/badge";
import { type DocumentItem } from "~/hooks/use-documents";
import { getIconForAuthorise } from "../icon-utils";
import { cn, formatString } from "~/lib/utils";
import { getStatusColor } from "./utils";
import { DocumentEditorView } from "./views/document-editor-view.client";
import { ClientOnly } from "remix-utils/client-only";
import { Input } from "../ui";
import { type Label, LabelDropdown } from "./label-dropdown";
import { format, isThisYear } from "date-fns";

interface LogDetailsProps {
  document: DocumentItem;
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

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return isThisYear(date) ? format(date, "MMM d") : format(date, "MMM d, yyyy");
};

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

export function LogDetails({ document, labels }: LogDetailsProps) {
  const [title, setTitle] = useState(document.title ?? "Untitled");
  const fetcher = useFetcher();
  const debounceTimerRef = useRef<NodeJS.Timeout>(null);

  // Update local state when document.title changes
  useEffect(() => {
    setTitle(document.title ?? "Untitled");
  }, [document.id]);

  // Debounced API call to update title
  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Don't make API call if title hasn't changed or is just initial load
    if (title === (document.title ?? "Untitled")) {
      return;
    }

    // Set new timer for debounced API call
    debounceTimerRef.current = setTimeout(() => {
      fetcher.submit(
        { title },
        {
          method: "PATCH",
          action: `/api/v1/documents/${document.id}`,
          encType: "application/json",
        },
      );
    }, 500); // 500ms debounce

    // Cleanup timer on unmount
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [title, document.id, document.title]);

  return (
    <div className="episode-details flex h-full w-full flex-col items-center overflow-auto">
      <div className="max-w-4xl min-w-[0px] md:min-w-3xl">
        <div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="no-scrollbar mt-5 resize-none overflow-hidden border-0 bg-transparent px-6 py-0 text-xl font-medium outline-none focus-visible:ring-0"
          />
        </div>
        <div className="bg-grayAlpha-100 mt-3 mb-3 flex w-full items-center rounded-xl px-3">
          <div className="flex flex-1 items-center gap-1 px-2 py-1.5">
            <PropertyItem
              label="Source"
              value={formatString(document.source?.toLowerCase())}
              icon={
                document.source &&
                getIconForAuthorise(
                  document.source.toLowerCase(),
                  16,
                  undefined,
                )
              }
              variant="ghost"
            />

            {document.status && document.status !== "COMPLETED" && (
              <PropertyItem
                label="Status"
                value={getStatusValue(document.status)}
                variant="status"
                statusColor={document.status && getStatusColor(document.status)}
              />
            )}

            <LabelDropdown
              value={document.labelIds}
              labels={labels}
              documentId={document.id}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground text-sm">
              {formatDate(document.createdAt)}
            </div>
          </div>
        </div>

        {/* Error Details */}
        {document.status && document.status !== "COMPLETED" && document.error && (
          <div className="mb-6 px-4">
            <div className="bg-destructive/10 rounded-md p-3">
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-sm break-words whitespace-pre-wrap">
                  {document.error}
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
          {() => <DocumentEditorView document={document} />}
        </ClientOnly>
      </div>
    </div>
  );
}

import { cn } from "~/lib/utils";
import { Badge, BadgeColor } from "../ui/badge";
import { type DocumentItem } from "~/hooks/use-documents";
import { getIconForAuthorise } from "../icon-utils";
import { useNavigate, useParams } from "@remix-run/react";
import { getStatusColor, getStatusValue } from "./utils";
import { File } from "lucide-react";
import { format, isThisYear } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { type Label, LabelDropdown } from "./label-dropdown";

interface LogTextCollapseProps {
  text?: string;
  error?: string;
  document: DocumentItem;
  id: string;
  reset?: () => void;
  labels: Label[];
}

export function LogTextCollapse({
  text,
  document,
  labels,
}: LogTextCollapseProps) {
  const { logId } = useParams();
  const navigate = useNavigate();

  // Show collapse if text is long (by word count)
  const COLLAPSE_WORD_LIMIT = 30;

  if (!text) {
    return (
      <div className="text-muted-foreground mb-2 text-sm italic">
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

  const showStatus = (document: DocumentItem) => {
    if (document.status === "COMPLETED") {
      return false;
    }

    return true;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return isThisYear(date)
      ? format(date, "MMM d")
      : format(date, "MMM d, yyyy");
  };

  return (
    <div className="flex w-full items-center">
      <div
        className={cn(
          "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-2",
          logId === document.id && "bg-grayAlpha-200",
        )}
        onClick={() => {
          navigate(`/home/episode/${document.id}`);
        }}
      >
        <div className="border-border flex w-full min-w-[0px] shrink flex-col gap-1 border-b py-2">
          <div className={cn("flex w-full min-w-[0px] shrink flex-col")}>
            <div className="flex w-full items-center gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start gap-2">
                <Badge
                  className={cn(
                    "text-foreground shrink-0 rounded !bg-transparent px-0 text-sm",
                  )}
                >
                  <File size={16} />
                </Badge>

                <div className={cn("truncate text-left")}>
                  {document.title ?? text.replace(/<[^>]+>/g, "")}
                </div>
              </div>

              <div className="flex grow gap-1"></div>

              <div className="text-muted-foreground flex shrink-0 items-center justify-center gap-2 text-sm">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      {getIconForAuthorise(
                        document.source.toLowerCase(),
                        16,
                        undefined,
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent>
                      <p>{document.source}</p>
                    </TooltipContent>
                  </TooltipPortal>
                </Tooltip>
                {showStatus(document) && (
                  <Badge
                    className={cn(
                      "!bg-grayAlpha-100 text-muted-foreground gap-1.5 rounded text-sm",
                    )}
                  >
                    <BadgeColor
                      style={{
                        backgroundColor: getStatusColor(document.status),
                      }}
                      className="mb-[1px]"
                    />
                    {getStatusValue(document.status)}
                  </Badge>
                )}
                <LabelDropdown
                  value={document.labelIds}
                  labels={labels}
                  documentId={document.id}
                  short
                />

                <div className="text-muted-foreground text-sm">
                  {formatDate(document.createdAt)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

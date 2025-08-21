import { Calendar } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import type { StatementNode } from "@core/types";
import { cn } from "~/lib/utils";

interface SpaceFactCardProps {
  fact: StatementNode;
}

export function SpaceFactCard({ fact }: SpaceFactCardProps) {
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const displayText = fact.fact;

  return (
    <>
      <div className="flex w-full items-center px-5 pr-2">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-4",
          )}
        >
          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-1",
            )}
          >
            <div className="flex w-full items-center justify-between gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink cursor-pointer items-center justify-start">
                <div className={cn("truncate text-left")}>{displayText}</div>
              </div>
              <div className="text-muted-foreground flex shrink-0 items-center justify-end text-xs">
                {fact.recallCount !== undefined && (
                  <span>Recalled: {fact.recallCount} times</span>
                )}
                <Badge variant="secondary" className="rounded text-xs">
                  <Calendar className="h-3 w-3" />
                  {formatDate(fact.validAt)}
                </Badge>
                {fact.invalidAt && (
                  <Badge variant="destructive" className="rounded text-xs">
                    Invalid since {formatDate(fact.invalidAt)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

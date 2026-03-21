import { Check, Ellipsis } from "lucide-react";
import { Button } from "../ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { getSourceIcon, getSourceLabel } from "./conversation-list";
import { cn } from "~/lib/utils";

export const ConversationListOptions = ({
  sources,
  hiddenSources,
  onToggleSource,
}: {
  sources: string[];
  hiddenSources: string[];
  onToggleSource: (source: string) => void;
}) => {
  const isFiltered = hiddenSources.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            "rounded",
            isFiltered ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Ellipsis size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {sources.map((source) => {
          const visible = !hiddenSources.includes(source);
          return (
            <DropdownMenuItem
              key={source}
              className="flex items-center gap-2"
              onClick={(e) => {
                e.preventDefault();
                onToggleSource(source);
              }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {visible ? <Check size={12} className="text-primary" /> : null}
              </span>

              <span className="truncate">{getSourceLabel(source)}</span>

              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {getSourceIcon(source)}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

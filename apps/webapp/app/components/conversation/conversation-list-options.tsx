import { Ellipsis, SlidersHorizontal } from "lucide-react";
import { Button } from "../ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { getSourceIcon } from "./conversation-list";

export const ConversationListOptions = ({
  sources,
  sourceFilter,
  onFilterChange,
}: {
  sources: string[];
  sourceFilter: string;
  onFilterChange: (source: string) => void;
}) => {
  const handleSelect = (value: string) => {
    onFilterChange(value);
  };

  const isFiltered = sourceFilter && sourceFilter !== "all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={
            isFiltered
              ? "text-primary rounded"
              : "text-muted-foreground rounded"
          }
        >
          <Ellipsis size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          className="text-sm"
          onClick={() => handleSelect("all")}
        >
          <span className="pl-6">All</span>
          {(!sourceFilter || sourceFilter === "all") && (
            <span className="bg-primary ml-auto h-1.5 w-1.5 rounded-full" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {sources.map((source) => (
          <DropdownMenuItem
            key={source}
            className="flex items-center gap-2 text-sm"
            onClick={() => handleSelect(source)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {getSourceIcon(source)}
            </span>
            <span className="truncate">{source}</span>
            {sourceFilter === source && (
              <span className="bg-primary ml-auto h-1.5 w-1.5 shrink-0 rounded-full" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

import { useState, useEffect, useCallback } from "react";
import { FileText, Plus, Loader2, Clock } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "../ui/command";
import { AddMemoryDialog } from "./memory-dialog.client";
import { useFetcher, useNavigate } from "@remix-run/react";

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchFetcher = useFetcher<any>();
  const navigate = useNavigate();

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      return;
    }

    const timeoutId = setTimeout(() => {
      searchFetcher.submit(
        {
          query: searchQuery,
          addId: true,
          adaptiveFiltering: false,
        },
        {
          method: "POST",
          action: "/api/v1/search",
          encType: "application/json",
        },
      );
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleAddMemory = () => {
    setShowAddMemory(true);
    onOpenChange(false);
  };

  const handleEpisodeClick = (episodeId: string) => {
    navigate(`/home/episode/${episodeId}`);
    onOpenChange(false);
  };

  const searchResults = searchFetcher.data?.episodes || [];
  const isSearching = searchFetcher.state !== "idle";

  return (
    <>
      {/* Main Command Dialog */}
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        commandProps={{ shouldFilter: false }}
      >
        <CommandInput
          placeholder="Search episodes or select an action..."
          className="py-1"
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          <CommandEmpty className="text-muted-foreground p-4 text-center text-sm">
            {searchQuery.trim().length > 0 && !isSearching
              ? "Start typing to search."
              : ""}
          </CommandEmpty>

          <CommandGroup className="p-2">
            <CommandItem
              onSelect={handleAddMemory}
              className="flex items-center gap-2 py-1"
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Add Memory</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <CommandGroup heading="Episodes" className="max-w-[50w] p-2">
          {isSearching && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          )}

          {!isSearching &&
            searchResults.length > 0 &&
            searchResults.map((episode: any, index: number) => (
              <CommandItem
                key={episode.uuid || index}
                onSelect={() => {
                  episode.uuid && handleEpisodeClick(episode.uuid);
                }}
                className="flex flex-col items-start gap-1 py-2"
              >
                <div className="flex w-full items-start gap-2">
                  <Clock className="mt-0.5 mr-2 h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 max-w-[400px] text-sm">
                      {episode.content}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {new Date(episode.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {episode.isCompact && " • Compact"}
                    </p>
                  </div>
                </div>
              </CommandItem>
            ))}

          {!isSearching && searchResults.length === 0 && (
            <div className="text-muted-foreground py-4 text-center text-sm">
              Start typing to search
            </div>
          )}
        </CommandGroup>
      </CommandDialog>

      {showAddMemory && (
        <AddMemoryDialog open={showAddMemory} onOpenChange={setShowAddMemory} />
      )}
    </>
  );
}

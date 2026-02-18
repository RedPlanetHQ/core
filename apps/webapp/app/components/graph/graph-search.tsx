import { useState, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { useDebounce } from "~/hooks/use-debounce";

interface GraphSearchProps {
  labelIds?: string[];
  onSessionIdsChange: (sessionIds: string[] | null) => void;
  placeholder?: string;
}

export function GraphSearch({
  labelIds,
  onSessionIdsChange,
  placeholder = "Search sessions...",
}: GraphSearchProps) {
  const [inputValue, setInputValue] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);

  const debouncedQuery = useDebounce(inputValue, 300);

  // Search when query or labelIds change
  useEffect(() => {
    const search = async () => {
      // If no query, clear filter
      if (!debouncedQuery.trim()) {
        onSessionIdsChange(null);
        setResultCount(null);
        return;
      }

      setIsSearching(true);

      try {
        const params = new URLSearchParams();
        params.set("q", debouncedQuery);
        params.set("mode", "sessionIds");

        if (labelIds && labelIds.length > 0) {
          params.set("labelIds", labelIds.join(","));
        }

        const response = await fetch(`/api/v1/documents/search?${params}`);

        if (response.ok) {
          const data = await response.json();
          onSessionIdsChange(data.sessionIds);
          setResultCount(data.count);
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    };

    search();
  }, [debouncedQuery, labelIds, onSessionIdsChange]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleClear = () => {
    setInputValue("");
    onSessionIdsChange(null);
    setResultCount(null);
  };

  const hasSearchQuery = inputValue.trim().length > 0;

  return (
    <div className="flex w-full max-w-md items-center gap-2">
      <div className="relative flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="pr-8 pl-10"
        />
        {hasSearchQuery && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2"
          >
            {isSearching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>

      {/* Show search results count */}
      {resultCount !== null && (
        <div className="text-muted-foreground shrink-0 text-sm">
          {resultCount} session{resultCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

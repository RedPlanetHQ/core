import { useState, useCallback, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { useDebounce } from "~/hooks/use-debounce";
import type { RawTriplet } from "./type";

interface SpaceSearchProps {
  triplets: RawTriplet[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  placeholder?: string;
}

export function SpaceSearch({
  triplets,
  searchQuery,
  onSearchChange,
  placeholder = "Search in statement facts...",
}: SpaceSearchProps) {
  const [inputValue, setInputValue] = useState(searchQuery);

  // Debounce the search to avoid too many re-renders
  const debouncedSearchQuery = useDebounce(inputValue, 300);

  // Update parent component when debounced value changes
  useMemo(() => {
    if (debouncedSearchQuery !== searchQuery) {
      onSearchChange(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, searchQuery, onSearchChange]);

  // Count statement nodes that match the search
  const matchingStatements = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return 0;

    const query = debouncedSearchQuery.toLowerCase();
    let count = 0;

    const isStatementNode = (node: any) => {
      return (
        node.attributes?.fact ||
        (node.labels && node.labels.includes("Statement"))
      );
    };

    triplets.forEach((triplet) => {
      // Check if source node is a statement and matches
      if (
        isStatementNode(triplet.sourceNode) &&
        triplet.sourceNode.attributes?.fact?.toLowerCase().includes(query)
      ) {
        count++;
      }

      // Check if target node is a statement and matches
      if (
        isStatementNode(triplet.targetNode) &&
        triplet.targetNode.attributes?.fact?.toLowerCase().includes(query)
      ) {
        count++;
      }
    });

    return count;
  }, [triplets, debouncedSearchQuery]);

  // Helper to determine if a node is a statement
  const isStatementNode = useCallback((node: any) => {
    // Check if node has a fact attribute (indicates it's a statement)
    return (
      node.attributes?.fact ||
      (node.labels && node.labels.includes("Statement"))
    );
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleClear = () => {
    setInputValue("");
    onSearchChange("");
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
            size="xs"
            onClick={handleClear}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Show search results count */}
      {debouncedSearchQuery.trim() && (
        <div className="text-muted-foreground shrink-0 text-sm">
          {matchingStatements} statement{matchingStatements !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

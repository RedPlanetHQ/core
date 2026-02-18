import { useState, useEffect } from "react";
import { Plus, Loader2, File } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "../ui/command";

import { useNavigate } from "@remix-run/react";
import { useDebounce } from "~/hooks/use-debounce";

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentResult {
  id: string;
  sessionId: string | null;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [documentResults, setDocumentResults] = useState<DocumentResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  // Search documents when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setDocumentResults([]);
      return;
    }

    const searchDocs = async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          mode: "full",
          limit: "10",
        });
        const response = await fetch(`/api/v1/documents/search?${params}`);
        if (response.ok) {
          const data = await response.json();
          setDocumentResults(data.documents || []);
        }
      } catch (error) {
        console.error("Document search failed:", error);
      } finally {
        setIsSearching(false);
      }
    };

    searchDocs();
  }, [debouncedQuery]);

  const handleAddDocument = () => {
    navigate(`/home/episode`);
    onOpenChange(false);
  };

  const handleDocumentClick = (documentId: string) => {
    navigate(`/home/episode/${documentId}`);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder="Search documents..."
        className="py-1"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className="h-72">
        <CommandEmpty className="text-muted-foreground p-4 text-center text-sm">
          {debouncedQuery.length >= 2 && !isSearching && documentResults.length === 0
            ? "No documents found."
            : ""}
        </CommandEmpty>

        <CommandGroup className="p-2">
          <CommandItem
            onSelect={handleAddDocument}
            className="flex items-center gap-2 py-1"
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>Add Document</span>
          </CommandItem>
        </CommandGroup>

        {/* Documents */}
        <CommandGroup heading="Documents" className="max-w-[700px] p-2">
          {isSearching && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          )}

          {!isSearching &&
            documentResults.map((doc) => (
              <CommandItem
                key={doc.id}
                value={doc.id}
                onSelect={() => handleDocumentClick(doc.id)}
                className="flex items-center gap-2 py-2"
                disabled={false}
              >
                <File className="h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{doc.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </CommandItem>
            ))}

          {!isSearching && documentResults.length === 0 && debouncedQuery.length < 2 && (
            <div className="text-muted-foreground py-4 text-center text-sm">
              Start typing to search
            </div>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

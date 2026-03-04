import { useState, useEffect } from "react";
import { Plus, Loader2, File, MessageSquare } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  Command,
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

interface ConversationResult {
  id: string;
  title: string | null;
  updatedAt: string;
}

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [documentResults, setDocumentResults] = useState<DocumentResult[]>([]);
  const [conversationResults, setConversationResults] = useState<ConversationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  // Search documents and conversations when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setDocumentResults([]);
      setConversationResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const [docsRes, convsRes] = await Promise.all([
          fetch(`/api/v1/documents/search?${new URLSearchParams({ q: debouncedQuery, mode: "full", limit: "10" })}`),
          fetch(`/api/v1/conversations?${new URLSearchParams({ search: debouncedQuery, limit: "10" })}`),
        ]);
        if (docsRes.ok) {
          const data = await docsRes.json();
          setDocumentResults(data.documents || []);
        }
        if (convsRes.ok) {
          const data = await convsRes.json();
          setConversationResults(data.conversations || []);
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    };

    search();
  }, [debouncedQuery]);

  const handleAddDocument = () => {
    navigate(`/home/document`);
    onOpenChange(false);
  };

  const handleDocumentClick = (documentId: string) => {
    navigate(`/home/documents/${documentId}`);
    onOpenChange(false);
  };

  const handleConversationClick = (conversationId: string) => {
    navigate(`/home/conversation/${conversationId}`);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search conversations and documents..."
          className="py-1"
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList className="h-72">
          <CommandEmpty className="text-muted-foreground p-4 text-center text-sm">
            {debouncedQuery.length >= 2 &&
            !isSearching &&
            documentResults.length === 0
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

          {/* Conversations */}
          {conversationResults.length > 0 && (
            <CommandGroup heading="Conversations" className="max-w-[700px] p-2">
              {conversationResults.map((conv) => (
                <CommandItem
                  key={conv.id}
                  value={conv.id}
                  onSelect={() => handleConversationClick(conv.id)}
                  className="flex items-center gap-2 py-2"
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm">
                      {conv.title || "Untitled Conversation"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(conv.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

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
                  onClick={() => {
                    console.log("clickeddddd");
                  }}
                  disabled={false}
                >
                  <File className="h-4 w-4 flex-shrink-0" />
                  <div
                    className="min-w-0 flex-1"
                    onClick={() => {
                      console.log("asdfasdfasd2e423423");
                    }}
                  >
                    <p className="text-foreground truncate text-sm">
                      {doc.title}
                    </p>
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

            {!isSearching &&
              documentResults.length === 0 &&
              debouncedQuery.length < 2 && (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  Start typing to search
                </div>
              )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

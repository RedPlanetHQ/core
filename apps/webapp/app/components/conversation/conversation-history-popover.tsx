import { useFetcher } from "@remix-run/react";
import { useEffect, useState, useRef, useCallback } from "react";
import { History, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { List, AutoSizer, type ListRowProps } from "react-virtualized";

type ConversationItem = {
  id: string;
  title: string | null;
  source: string;
  updatedAt: string;
  unread: boolean;
};

type ConversationListResponse = {
  conversations: ConversationItem[];
  pagination: {
    page: number;
    hasNext: boolean;
    total: number;
  };
};

const ITEM_HEIGHT = 36;
const LIST_HEIGHT = 280;

export function ConversationHistoryPopover({
  onSelect,
  currentConversationId,
}: {
  onSelect: (conversationId: string) => void;
  currentConversationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loadedIds = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  const fetcher = useFetcher<ConversationListResponse>();

  const buildUrl = useCallback(
    (p: number, q?: string) => {
      const base = `/api/v1/conversations?unread=false&page=${p}&limit=30`;
      return q ? `${base}&search=${encodeURIComponent(q)}` : base;
    },
    [],
  );

  // Reset and reload when popover opens
  useEffect(() => {
    if (!open) return;
    loadedIds.current = new Set();
    setConversations([]);
    setPage(1);
    setHasMore(true);
    fetcher.load(buildUrl(1, query || undefined));
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      loadedIds.current = new Set();
      setConversations([]);
      setPage(1);
      setHasMore(true);
      fetcher.load(buildUrl(1, query || undefined));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Append results
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const newItems = fetcher.data.conversations.filter(
      (c) => !loadedIds.current.has(c.id),
    );
    newItems.forEach((c) => loadedIds.current.add(c.id));
    setConversations((prev) => [...prev, ...newItems]);
    setHasMore(fetcher.data.pagination.hasNext);
    setPage(fetcher.data.pagination.page);
  }, [fetcher.state, fetcher.data]);

  const loadMore = useCallback(() => {
    if (!hasMore || fetcher.state !== "idle") return;
    const nextPage = page + 1;
    fetcher.load(buildUrl(nextPage, query || undefined));
  }, [hasMore, fetcher, page, query, buildUrl]);

  const handleSelect = (id: string) => {
    setOpen(false);
    setQuery("");
    onSelect(id);
  };

  // Trigger load more when near bottom
  const handleScroll = useCallback(
    ({
      scrollTop,
      clientHeight,
      scrollHeight,
    }: {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    }) => {
      if (scrollTop + clientHeight >= scrollHeight - ITEM_HEIGHT * 3) {
        loadMore();
      }
    },
    [loadMore],
  );

  const rowRenderer = ({ index, key, style }: ListRowProps) => {
    const conversation = conversations[index];
    if (!conversation) return null;
    const isActive = conversation.id === currentConversationId;
    return (
      <div key={key} style={style} className="p-1 pb-0.5">
        <Button
          onClick={() => handleSelect(conversation.id)}
          isActive={isActive}
          className="w-full truncate text-left"
          size="lg"
          variant="ghost"
        >
          {conversation.unread && (
            <span className="bg-primary h-1.5 w-1.5 shrink-0 rounded-full" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {conversation.title
              ? conversation.title.replace(/<[^>]*>/g, "").trim() ||
                "Untitled Conversation"
              : "Untitled Conversation"}
          </span>
        </Button>
      </div>
    );
  };

  const isLoading = fetcher.state !== "idle";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="rounded"
          title="Conversation history"
        >
          <History size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" side="bottom">
        {/* Search */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {/* Virtual list */}
        {conversations.length === 0 && !isLoading ? (
          <p className="text-muted-foreground px-3 py-3 text-xs">
            No conversations found
          </p>
        ) : (
          <div
            style={{
              height: Math.min(conversations.length * ITEM_HEIGHT, LIST_HEIGHT),
            }}
          >
            <AutoSizer disableHeight>
              {({ width }) => (
                <List
                  width={width}
                  height={Math.min(
                    conversations.length * ITEM_HEIGHT,
                    LIST_HEIGHT,
                  )}
                  rowCount={conversations.length}
                  rowHeight={ITEM_HEIGHT}
                  rowRenderer={rowRenderer}
                  onScroll={handleScroll}
                  overscanRowCount={5}
                />
              )}
            </AutoSizer>
          </div>
        )}

        {isLoading && (
          <p className="text-muted-foreground border-t px-3 py-2 text-xs">
            Loading…
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

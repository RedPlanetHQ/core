import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  List,
  AutoSizer,
  InfiniteLoader,
  type ListRowRenderer,
} from "react-virtualized";
import { format } from "date-fns";
import { MessageSquare, Clock, Plus } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";

type ConversationItem = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
  status: string;
  ConversationHistory: Array<{
    id: string;
    message: string;
    userType: string;
    createdAt: string;
  }>;
};

type ConversationListResponse = {
  conversations: ConversationItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

export const ConversationList = ({
  currentConversationId,
  showNewConversationCTA,
}: {
  currentConversationId?: string;
  showNewConversationCTA?: boolean;
}) => {
  const fetcher = useFetcher<ConversationListResponse>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  // const [searchTerm, setSearchTerm] = useState("");
  // const searchTimeoutRef = useRef<NodeJS.Timeout>();

  const loadMoreConversations = useCallback(
    (page: number) => {
      if (isLoading) return;

      setIsLoading(true);
      const searchParams = new URLSearchParams({
        page: page.toString(),
        limit: "25",
      });

      fetcher.load(`/api/v1/conversations?${searchParams}`, {
        flushSync: true,
      });
    },
    [isLoading, fetcher, currentPage],
  );

  useEffect(() => {
    loadMoreConversations(1);
  }, []);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setIsLoading(false);
      const response = fetcher.data;

      if (currentPage === 1) {
        setConversations(response.conversations);
      } else {
        setConversations((prev) => [...prev, ...response.conversations]);
      }

      setHasNextPage(response.pagination.hasNext);
      setCurrentPage(response.pagination.page);
    }
  }, [fetcher.data, fetcher.state, currentPage]);

  // const handleSearch = useCallback(
  //   (term: string) => {
  //     setSearchTerm(term);
  //     setCurrentPage(1);
  //     setConversations([]);
  //     setHasNextPage(true);

  //     if (searchTimeoutRef.current) {
  //       clearTimeout(searchTimeoutRef.current);
  //     }

  //     searchTimeoutRef.current = setTimeout(() => {
  //       loadMoreConversations(1);
  //     }, 300);
  //   },
  //   [loadMoreConversations],
  // );

  const isRowLoaded = useCallback(
    ({ index }: { index: number }) => {
      return !!conversations[index];
    },
    [conversations],
  );

  const loadMoreRows = useCallback(() => {
    if (!hasNextPage || isLoading) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      if (conversations.length === 25) {
        const nextPage = currentPage + 1;
        loadMoreConversations(nextPage);
        const checkLoaded = () => {
          if (!isLoading) {
            resolve();
          } else {
            setTimeout(checkLoaded, 100);
          }
        };
        checkLoaded();
      }
    });
  }, [
    hasNextPage,
    isLoading,
    currentPage,
    loadMoreConversations,
    conversations,
  ]);

  const rowRenderer: ListRowRenderer = useCallback(
    ({ index, key, style }) => {
      const conversation = conversations[index];

      if (!conversation) {
        return (
          <div key={key} style={style}>
            <div className="flex items-center justify-center p-4">
              <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          </div>
        );
      }

      return (
        <div key={key} style={style}>
          <div className="p-1">
            <Button
              variant="ghost"
              className={cn(
                "border-border h-auto w-full justify-start p-2 text-left",
                currentConversationId === conversation.id && "bg-grayAlpha-100",
              )}
              onClick={() => {
                window.location.href = `/home/conversation/${conversation.id}`;
              }}
            >
              <div className="flex w-full items-start space-x-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate font-normal")}>
                      {conversation.title || "Untitled Conversation"}
                    </p>
                    <div className="text-muted-foreground flex items-center space-x-1 text-xs">
                      <span>
                        {format(new Date(conversation.updatedAt), "MMM d")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Button>
          </div>
        </div>
      );
    },
    [conversations],
  );

  const rowCount = hasNextPage
    ? conversations.length + 1
    : conversations.length;

  return (
    <div className="flex h-full flex-col">
      {showNewConversationCTA && (
        <div className="flex items-center justify-start p-1 pb-0">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 py-4"
            onClick={() => {
              navigate("/home/conversation");
            }}
          >
            <Plus size={14} /> New conversation
          </Button>
        </div>
      )}
      {/* <div className="border-b">
        <Input
          type="text"
          placeholder="Search conversations..."
          className="focus:ring-primary w-full rounded-none px-3 py-2 focus:ring-2 focus:outline-none"
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div> */}

      <div className="flex-1 overflow-hidden">
        <InfiniteLoader
          isRowLoaded={isRowLoaded}
          loadMoreRows={loadMoreRows}
          rowCount={rowCount}
          threshold={5}
        >
          {({ onRowsRendered, registerChild }) => (
            <AutoSizer>
              {({ height, width }) => (
                <List
                  ref={registerChild}
                  height={height}
                  width={width}
                  rowCount={rowCount}
                  rowHeight={40}
                  onRowsRendered={onRowsRendered}
                  rowRenderer={rowRenderer}
                  overscanRowCount={5}
                />
              )}
            </AutoSizer>
          )}
        </InfiniteLoader>
      </div>

      {isLoading && conversations.length === 0 && (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center space-x-2">
            <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
            <span className="text-muted-foreground text-sm">
              Loading conversations...
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

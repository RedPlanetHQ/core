import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { AutoSizer, List, type ListRowRenderer } from "react-virtualized";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import { LoaderCircle } from "lucide-react";

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
}: {
  currentConversationId?: string;
}) => {
  const fetcher = useFetcher<ConversationListResponse>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Prevent duplicate conversations when paginating
  const loadedConversationIds = useRef<Set<string>>(new Set());

  const loadMoreConversations = useCallback(
    (page: number) => {
      if (isLoading) return;

      setIsLoading(true);
      const searchParams = new URLSearchParams({
        page: page.toString(),
        limit: "5", // Increased for better density
      });

      fetcher.load(`/api/v1/conversations?${searchParams}`);
    },
    [isLoading, fetcher],
  );

  // Initial load
  useEffect(() => {
    loadMoreConversations(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setIsLoading(false);
      const response = fetcher.data;

      // Prevent duplicate conversations
      const newConversations = response.conversations.filter(
        (c) => !loadedConversationIds.current.has(c.id),
      );
      newConversations.forEach((c) => loadedConversationIds.current.add(c.id));

      setConversations((prev) => [...prev, ...newConversations]);
      setHasNextPage(response.pagination.hasNext);
      setCurrentPage(response.pagination.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  // The row count is conversations.length + 1 if hasNextPage, else just conversations.length
  const rowCount = hasNextPage
    ? conversations.length + 1
    : conversations.length;

  const rowRenderer: ListRowRenderer = useCallback(
    ({ index, key, style }) => {
      // If this is the last row and hasNextPage, show the Load More button
      if (hasNextPage && index === conversations.length) {
        return (
          <div
            key={key}
            style={style}
            className="-mt-1 ml-1 hidden items-center justify-start p-0 text-sm group-hover:flex"
          >
            <Button
              variant="link"
              onClick={() => loadMoreConversations(currentPage + 1)}
              disabled={isLoading}
              className="w-fit underline underline-offset-4"
            >
              {isLoading ? (
                <>
                  <div className="border-primary mr-2 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                  Loading...
                </>
              ) : (
                "Load More"
              )}
            </Button>
          </div>
        );
      }

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
          <div className="px-1 pr-2">
            <Button
              variant={
                currentConversationId === conversation.id
                  ? "secondary"
                  : "ghost"
              }
              className={cn(
                "border-border h-auto w-fit max-w-[200px] justify-start rounded p-2 py-1 text-left",
              )}
              onClick={() => {
                navigate(`/home/conversation/${conversation.id}`);
              }}
              tabIndex={0}
              aria-current={
                currentConversationId === conversation.id ? "page" : undefined
              }
            >
              <div className="border-border flex w-full min-w-[0px] shrink flex-col gap-1">
                <div className={cn("flex w-full min-w-[0px] shrink flex-col")}>
                  <div className="flex w-full items-center gap-4">
                    <div className="inline-flex min-w-[0px] shrink items-center justify-start gap-2">
                      <div className={cn("truncate text-left text-base")}>
                        {conversation.title || "Untitled Conversation"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Button>
          </div>
        </div>
      );
    },
    [
      conversations,
      currentConversationId,
      hasNextPage,
      isLoading,
      currentPage,
      loadMoreConversations,
      navigate,
    ],
  );

  return (
    <div className="flex h-full flex-col pt-1 pl-1">
      {!isLoading && conversations.length > 0 && (
        <div className="group grow overflow-hidden">
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                rowCount={rowCount}
                rowHeight={32} // Slightly taller for better click area
                rowRenderer={rowRenderer}
                overscanRowCount={5}
              />
            )}
          </AutoSizer>
        </div>
      )}

      {isLoading && conversations.length === 0 && (
        <div className="flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-2">
            <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
          </div>
        </div>
      )}
    </div>
  );
};

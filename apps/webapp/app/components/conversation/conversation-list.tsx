import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import { LoaderCircle, Timer } from "lucide-react";
import { getIcon, type IconType } from "../icon-utils";

export function getSourceIcon(source: string) {
  if (!source || source === "core") return null;
  if (source === "background-task") return <Timer size={13} />;
  const key = source.startsWith("integration_")
    ? source.slice("integration_".length)
    : source;
  const IconComponent = getIcon(key as IconType);
  return <IconComponent size={13} />;
}

type ConversationItem = {
  id: string;
  title: string | null;
  source: string;
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

  const loadedConversationIds = useRef<Set<string>>(new Set());

  const loadMoreConversations = useCallback(
    (page: number) => {
      if (isLoading) return;
      setIsLoading(true);
      fetcher.load(`/api/v1/conversations?page=${page}&limit=5`);
    },
    [isLoading, fetcher],
  );

  useEffect(() => {
    loadMoreConversations(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setIsLoading(false);
      const newConversations = fetcher.data.conversations.filter(
        (c) => !loadedConversationIds.current.has(c.id),
      );
      newConversations.forEach((c) => loadedConversationIds.current.add(c.id));
      setConversations((prev) => [...prev, ...newConversations]);
      setHasNextPage(fetcher.data.pagination.hasNext);
      setCurrentPage(fetcher.data.pagination.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  return (
    <div className="flex w-full flex-col px-2 pt-1">
      <p className="text-muted-foreground mb-1 px-2 text-sm">Chats</p>

      {isLoading && conversations.length === 0 && (
        <div className="flex justify-center p-4">
          <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
        </div>
      )}

      {conversations.map((conversation) => (
        <div key={conversation.id} className="flex w-full">
          <Button
            variant={
              currentConversationId === conversation.id ? "secondary" : "ghost"
            }
            className={cn(
              "border-border text-foreground h-auto justify-start rounded p-2 py-1 text-left",
            )}
            onClick={() => navigate(`/home/conversation/${conversation.id}`)}
            full
            tabIndex={0}
            aria-current={
              currentConversationId === conversation.id ? "page" : undefined
            }
          >
            <div className="flex w-full min-w-0 items-center gap-2">
              <span className="min-w-0 grow truncate text-left text-base">
                {conversation.title || "Untitled Conversation"}
              </span>
              {getSourceIcon(conversation.source) && (
                <span className="shrink-0">
                  {getSourceIcon(conversation.source)}
                </span>
              )}
            </div>
          </Button>
        </div>
      ))}

      {hasNextPage && (
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
      )}
    </div>
  );
};

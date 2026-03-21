import { useFetcher, useNavigate, useLocation } from "@remix-run/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import {
  GitBranch,
  LoaderCircle,
  Timer,
  Folder,
  FolderOpen,
} from "lucide-react";
import { getIcon, type IconType } from "../icon-utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { SourceFolderMenu } from "./source-folder-menu";
import { ConversationListOptions } from "./conversation-list-options";

export function getSourceIcon(source: string) {
  if (!source || source === "core") return null;
  if (source === "reminder") return <Timer size={13} />;
  if (source === "background-task") return <GitBranch size={13} />;
  const key = source.startsWith("integration_")
    ? source.slice("integration_".length)
    : source;
  const IconComponent = getIcon(key as IconType);
  return <IconComponent size={14} />;
}

export function getSourceLabel(source: string): string {
  if (!source || source === "core") return "General";
  if (source === "reminder") return "Reminders";
  if (source === "background-task") return "Background Tasks";
  if (source.startsWith("integration_")) {
    const name = source.slice("integration_".length);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return source.charAt(0).toUpperCase() + source.slice(1);
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

function SourceFolder({
  source,
  totalCount,
  currentConversationId,
  locationPathname,
}: {
  source: string;
  totalCount: number;
  currentConversationId?: string;
  locationPathname: string;
}) {
  const navigate = useNavigate();
  const fetcher = useFetcher<ConversationListResponse>({
    key: `conv-list-${source}`,
  });
  const icon = getSourceIcon(source);
  const label = getSourceLabel(source);
  const [open, setOpen] = useLocalCommonState<boolean>(
    `conv-folder-${source}`,
    false,
  );

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const loadedIds = useRef<Set<string>>(new Set());
  const isPageReset = useRef(false);

  const loadPage = useCallback(
    (page: number) => {
      setIsLoading(true);
      const sourceParam =
        source === "core" ? "&source=core" : `&source=${source}`;
      fetcher.load(
        `/api/v1/conversations?unread=false&page=${page}&limit=10${sourceParam}`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetcher, source],
  );

  // Reload on path change
  useEffect(() => {
    isPageReset.current = true;
    loadedIds.current = new Set();
    setCurrentPage(1);
    setHasNextPage(true);
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationPathname]);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setIsLoading(false);

      if (isPageReset.current) {
        isPageReset.current = false;
        const newConvs = fetcher.data.conversations;
        loadedIds.current = new Set(newConvs.map((c) => c.id));
        setConversations(newConvs);
      } else {
        const newConvs = fetcher.data.conversations.filter(
          (c) => !loadedIds.current.has(c.id),
        );
        newConvs.forEach((c) => loadedIds.current.add(c.id));
        setConversations((prev) => [...prev, ...newConvs]);
      }

      setHasNextPage(fetcher.data.pagination.hasNext);
      setCurrentPage(fetcher.data.pagination.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const isOpen = open ?? false;

  function handleDeleted() {
    loadedIds.current = new Set();
    setConversations([]);
    setHasNextPage(false);
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setOpen}>
      <div className="group/folder flex items-center">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            isActive={isOpen}
            className="mb-0.5 w-full min-w-0 flex-1 gap-2"
          >
            {isOpen ? (
              <FolderOpen size={16} className="shrink-0" />
            ) : (
              <Folder size={16} className="shrink-0" />
            )}

            <span className="truncate">{label}</span>

            {icon && <span className="shrink-0">{icon}</span>}
            {totalCount > 0 && (
              <span className="text-muted-foreground text-sm">
                {totalCount}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-2">
              <SourceFolderMenu source={source} onDeleted={handleDeleted} />
            </span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="pl-3">
          {isLoading && conversations.length === 0 && (
            <div className="flex justify-center p-2">
              <LoaderCircle className="text-primary h-3.5 w-3.5 animate-spin" />
            </div>
          )}

          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="mb-0.5 flex min-h-[28px] w-full"
            >
              <Button
                variant={
                  currentConversationId === conversation.id
                    ? "secondary"
                    : "ghost"
                }
                className="border-border text-foreground h-auto justify-start rounded p-2 py-1 text-left"
                onClick={() =>
                  navigate(`/home/conversation/${conversation.id}`)
                }
                full
                tabIndex={0}
                isActive={currentConversationId === conversation.id}
                aria-current={
                  currentConversationId === conversation.id ? "page" : undefined
                }
              >
                <span className="min-w-0 grow truncate text-left text-base">
                  {conversation.title || "Untitled Conversation"}
                </span>
              </Button>
            </div>
          ))}

          {hasNextPage && (
            <Button
              variant="link"
              onClick={() => loadPage(currentPage + 1)}
              disabled={isLoading}
              className="w-fit underline underline-offset-4"
            >
              {isLoading ? (
                <>
                  <div className="border-primary mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                  Loading...
                </>
              ) : (
                "Load More"
              )}
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const ConversationList = ({
  currentConversationId,
  conversationSources,
}: {
  currentConversationId?: string;
  conversationSources: { source: string; count: number }[];
}) => {
  const location = useLocation();
  const [hiddenSources, setHiddenSources] = useLocalCommonState<string[]>(
    "conv-hidden-sources",
    [],
  );

  const sorted = [...conversationSources].sort((a, b) => {
    if (a.source === "core") return -1;
    if (b.source === "core") return 1;
    return getSourceLabel(a.source).localeCompare(getSourceLabel(b.source));
  });

  const hidden = hiddenSources ?? [];
  const filtered = sorted.filter(({ source }) => !hidden.includes(source));

  const handleToggleSource = (source: string) => {
    const current = hiddenSources ?? [];
    if (current.includes(source)) {
      setHiddenSources(current.filter((s) => s !== source));
    } else {
      setHiddenSources([...current, source]);
    }
  };

  return (
    <div className="group/convo flex w-full flex-col px-2 pt-1">
      <div className="mb-1 flex items-center justify-between px-2">
        <p className="text-muted-foreground text-sm">Chats</p>
        <span className="opacity-0 transition-opacity group-hover/convo:opacity-100 has-[[data-state=open]]:opacity-100">
          <ConversationListOptions
            sources={sorted.map(({ source }) => source)}
            hiddenSources={hidden}
            onToggleSource={handleToggleSource}
          />
        </span>
      </div>

      {filtered.map(({ source, count }) => (
        <SourceFolder
          key={source}
          source={source}
          totalCount={count}
          currentConversationId={currentConversationId}
          locationPathname={location.pathname}
        />
      ))}
    </div>
  );
};

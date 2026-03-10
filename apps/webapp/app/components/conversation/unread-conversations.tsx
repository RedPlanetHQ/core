import { useFetcher, useNavigate, useLocation } from "@remix-run/react";
import { useEffect } from "react";
import { Ellipsis, GitBranch, Timer } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { getIcon, type IconType } from "../icon-utils";

type ConversationItem = {
  id: string;
  title: string | null;
  source: string;
  updatedAt: string;
  unread: boolean;
};

type ConversationListResponse = {
  conversations: ConversationItem[];
};

function getSourceIcon(source: string) {
  if (!source || source === "core") return null;
  if (source === "reminder") return <Timer size={13} />;
  if (source === "background-task") return <GitBranch size={13} />;
  const key = source.startsWith("integration_")
    ? source.slice("integration_".length)
    : source;
  const IconComponent = getIcon(key as IconType);
  return <IconComponent size={16} />;
}

export const UnreadConversations = ({
  currentConversationId,
}: {
  currentConversationId?: string;
}) => {
  const fetcher = useFetcher<ConversationListResponse>();
  const readAllFetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetcher.load("/api/v1/conversations?unread=true&limit=50");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const conversations = fetcher.data?.conversations ?? [];

  if (conversations.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col px-2 pt-1">
      <div className="mb-1 flex items-center justify-between px-2 pr-0">
        <p className="text-muted-foreground text-sm">Unread</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground rounded"
            >
              <Ellipsis size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-sm"
              onClick={() =>
                readAllFetcher.submit(
                  {},
                  { method: "POST", action: "/api/v1/conversations/read-all" },
                )
              }
            >
              Mark all as read
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {conversations.map((conversation) => {
        const icon = getSourceIcon(conversation.source);
        return (
          <div key={conversation.id} className="flex w-full">
            <Button
              variant={
                currentConversationId === conversation.id
                  ? "secondary"
                  : "ghost"
              }
              className={cn(
                "border-border text-foreground h-auto justify-start rounded p-2 py-1 text-left",
              )}
              onClick={() => navigate(`/home/conversation/${conversation.id}`)}
              full
            >
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className="bg-primary h-1.5 w-1.5 shrink-0 rounded-full" />
                <span className="min-w-0 grow truncate text-base">
                  {conversation.title || "Untitled Conversation"}
                </span>
                {icon && <span className="shrink-0">{icon}</span>}
              </div>
            </Button>
          </div>
        );
      })}
    </div>
  );
};

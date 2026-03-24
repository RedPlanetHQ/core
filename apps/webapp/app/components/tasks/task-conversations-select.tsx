import { Loader2 } from "lucide-react";
import { Link } from "@remix-run/react";
import { ConversationView } from "~/components/conversation";
import type { getConversationAndHistory } from "~/services/conversation.server";

type ConversationItem = NonNullable<
  Awaited<ReturnType<typeof getConversationAndHistory>>
>;

export function formatRunLabel(conv: ConversationItem, index: number): string {
  const date = new Date(conv.createdAt);
  const label = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Run ${index + 1} — ${label}`;
}

interface TaskConversationsSelectProps {
  conversations: ConversationItem[];
  selectedId: string;
  integrationAccountMap?: Record<string, string>;
  butlerName?: string;
}

export function TaskConversationsSelect({
  conversations,
  selectedId,
  integrationAccountMap = {},
  butlerName = "Core",
}: TaskConversationsSelectProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted-foreground text-base">
          {butlerName} can work on this task in the background, or you can{" "}
          <Link
            to="/home/conversation"
            className="underline underline-offset-2"
          >
            start working on it in a new chat
          </Link>
          .
        </p>
      </div>
    );
  }

  const selected =
    conversations.find((c) => c.id === selectedId) ??
    conversations[conversations.length - 1];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {selected.status === "running" && (
        <div className="text-muted-foreground flex items-center gap-1.5 border-b border-gray-200 px-3 py-2 text-xs">
          <Loader2 size={11} className="animate-spin" />
          {butlerName} is working…
        </div>
      )}
      <ConversationView
        key={selected.id}
        conversationId={selected.id}
        history={selected.ConversationHistory}
        integrationAccountMap={integrationAccountMap}
        className="py-0"
        conversationStatus={selected.status}
      />
    </div>
  );
}

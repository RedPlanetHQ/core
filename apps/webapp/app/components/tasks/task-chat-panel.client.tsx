import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageSquare, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ConversationView } from "~/components/conversation";
import type { TaskRun } from "~/services/conversation.server";

interface TaskChatPanelProps {
  runs: TaskRun[];
  integrationAccountMap: Record<string, string>;
  onClose: () => void;
}

export function TaskChatPanel({
  runs,
  integrationAccountMap,
  onClose,
}: TaskChatPanelProps) {
  const homeData = useRouteLoaderData("routes/home") as any;
  const models = homeData?.models ?? [];

  const latestRun = runs[0] ?? null;

  const historyFetcher = useFetcher<{
    conversation: {
      id: string;
      status: string;
      ConversationHistory: Array<{
        id: string;
        userType: string;
        message: string;
        parts: any[];
      }>;
    };
  }>();

  const [activeConversation, setActiveConversation] = useState<{
    conversationId: string;
    status: string | undefined;
    history: Array<{
      id: string;
      userType: string;
      message: string;
      parts: any[];
    }>;
  } | null>(null);

  const loadedRunId = useRef<string | null>(null);

  useEffect(() => {
    if (latestRun && loadedRunId.current !== latestRun.id) {
      loadedRunId.current = latestRun.id;
      historyFetcher.load(`/home/conversation/${latestRun.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.id]);

  useEffect(() => {
    if (historyFetcher.state === "idle" && historyFetcher.data?.conversation) {
      const conv = historyFetcher.data.conversation;
      setActiveConversation({
        conversationId: conv.id,
        status: conv.status,
        history: conv.ConversationHistory ?? [],
      });
    }
  }, [historyFetcher.state, historyFetcher.data]);

  return (
    <div className="flex h-full flex-col">
      {!latestRun ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
          <MessageSquare size={24} className="text-muted-foreground" />
          <p className="text-muted-foreground text-center text-sm">
            No runs yet for this task.
            <br />
            Run the task to start a conversation.
          </p>
        </div>
      ) : !activeConversation ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <ConversationView
            conversationId={activeConversation.conversationId}
            history={activeConversation.history}
            conversationStatus={activeConversation.status}
            autoRegenerate
            integrationAccountMap={integrationAccountMap}
            models={models}
          />
        </div>
      )}
    </div>
  );
}

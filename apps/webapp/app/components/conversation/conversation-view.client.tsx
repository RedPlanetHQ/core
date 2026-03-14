import { useEffect } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { UserTypeEnum } from "@core/types";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";
import { ConversationItem } from "./conversation-item.client";
import { ConversationTextarea } from "./conversation-textarea.client";
import { ThinkingIndicator } from "./thinking-indicator.client";
import { hasNeedsApprovalDeep } from "./conversation-utils";
import { cn } from "~/lib/utils";

interface ConversationHistory {
  id: string;
  userType: string;
  message: string;
  parts: any;
}

interface ConversationViewProps {
  conversationId: string;
  history: ConversationHistory[];
  className?: string;
  integrationAccountMap?: Record<string, string>;
  /** When true, auto-triggers regenerate if history has only 1 message */
  autoRegenerate?: boolean;
}

export function ConversationView({
  conversationId,
  history,
  className,
  integrationAccountMap = {},
  autoRegenerate = false,
}: ConversationViewProps) {
  const {
    sendMessage,
    messages,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId,
    messages: history.map(
      (h) =>
        ({
          id: h.id,
          role: h.userType === UserTypeEnum.Agent ? "assistant" : "user",
          parts: h.parts ? h.parts : [{ text: h.message, type: "text" }],
        }) as UIMessage,
    ),
    transport: new DefaultChatTransport({
      api: "/api/v1/conversation",
      prepareSendMessagesRequest({ messages, id }) {
        const lastAssistant = [...messages]
          .reverse()
          .find((m) => m.role === "assistant") as UIMessage | undefined;

        const needsApproval = !!lastAssistant?.parts.find(
          (p: any) => p.state === "approval-responded",
        );

        if (needsApproval) {
          return { body: { messages, needsApproval: true, id } };
        }
        return { body: { message: messages[messages.length - 1], id } };
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  useEffect(() => {
    if (autoRegenerate && history.length === 1) {
      regenerate();
    }
  }, []);

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant") as UIMessage | undefined;

  const needsApproval = lastAssistant?.parts
    ? hasNeedsApprovalDeep(lastAssistant.parts)
    : false;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-end overflow-hidden py-4 pb-12 lg:pb-4",
        className,
      )}
    >
      <ScrollAreaWithAutoScroll>
        {messages.map((message: UIMessage, i: number) => (
          <ConversationItem
            key={i}
            message={message}
            addToolApprovalResponse={addToolApprovalResponse}
            integrationAccountMap={integrationAccountMap}
          />
        ))}
      </ScrollAreaWithAutoScroll>

      <div className="flex w-full flex-col items-center">
        <div className="w-full max-w-[90ch] px-4">
          <ThinkingIndicator isLoading={status === "streaming" || status === "submitted"} />
          <ConversationTextarea
            className="bg-background-3 border-1 w-full border-gray-300"
            isLoading={status === "streaming" || status === "submitted"}
            disabled={needsApproval}
            onConversationCreated={(message) => {
              if (message) sendMessage({ text: message });
            }}
            stop={() => stop()}
          />
        </div>
      </div>
    </div>
  );
}

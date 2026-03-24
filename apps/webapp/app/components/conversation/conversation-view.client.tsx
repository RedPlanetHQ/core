import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { UserTypeEnum } from "@core/types";
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
  /** DB conversation status — input is disabled when "running" */
  conversationStatus?: string;
}

export function ConversationView({
  conversationId,
  history,
  className,
  integrationAccountMap = {},
  autoRegenerate = false,
  conversationStatus,
}: ConversationViewProps) {
  const readFetcher = useFetcher();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // initialize to history.length so mount doesn't trigger the scroll effect
  const prevMessageCountRef = useRef(history.length);
  // spacer height = scroll container clientHeight so any message can scroll to top
  const [spacerHeight, setSpacerHeight] = useState(0);
  // keeps spacer alive after streaming ends until user scrolls back to bottom
  const [keepSpacer, setKeepSpacer] = useState(false);

  const {
    sendMessage,
    messages,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId,
    onFinish: () => {
      readFetcher.submit(null, {
        method: "GET",
        action: `/api/v1/conversation/${conversationId}/read`,
      });
    },
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

  // Measure scroll container and keep spacer in sync so any message can reach the top
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => setSpacerHeight(container.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // On initial load, scroll to bottom to show latest messages
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Remove spacer when user scrolls back to bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 30) {
        setKeepSpacer(false);
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // When a new user message is added, force-scroll it to the top of the container
  useEffect(() => {
    const newCount = messages.length;
    if (newCount > prevMessageCountRef.current) {
      const lastMsg = messages[newCount - 1];
      if (lastMsg.role === "user") {
        setKeepSpacer(true);
        requestAnimationFrame(() => {
          const el = messageRefs.current[newCount - 1];
          const container = scrollContainerRef.current;
          if (!el || !container) return;
          const elRect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const target =
            container.scrollTop + (elRect.top - containerRect.top) - 20;
          container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        });
      }
    }
    prevMessageCountRef.current = newCount;
  }, [messages.length]);

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
      <div
        ref={scrollContainerRef}
        className="flex grow flex-col items-center overflow-y-auto"
      >
        <div className="flex w-full max-w-[90ch] flex-col pb-4">
          {messages.map((message: UIMessage, i: number) => (
            <div
              key={i}
              ref={(el) => {
                messageRefs.current[i] = el;
              }}
            >
              <ConversationItem
                message={message}
                addToolApprovalResponse={addToolApprovalResponse}
                integrationAccountMap={integrationAccountMap}
              />
            </div>
          ))}
          {/* Spacer while streaming or until user scrolls back to bottom */}
          {(status === "streaming" || status === "submitted" || keepSpacer) && (
            <div style={{ height: spacerHeight, flexShrink: 0 }} />
          )}
        </div>
      </div>

      <div className="flex w-full flex-col items-center">
        <div className="w-full max-w-[90ch] px-4">
          <ThinkingIndicator
            isLoading={status === "streaming" || status === "submitted"}
          />
          <ConversationTextarea
            className="bg-background-3 border-1 w-full border-gray-300"
            isLoading={status === "streaming" || status === "submitted"}
            disabled={needsApproval || conversationStatus === "running"}
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

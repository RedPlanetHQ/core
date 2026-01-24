import { type UIMessage, useChat } from "@ai-sdk/react";
import { type UserType } from "@core/database";
import { UserTypeEnum } from "@core/types";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useRef } from "react";
import {
  ConversationItem,
  ConversationTextarea,
} from "~/components/conversation";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";

interface OnboardingChatProps {
  onboardingSummary: string;
  conversation: {
    ConversationHistory: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      deleted: Date | null;
      message: string;
      parts: any | null;
      userType: UserType;
      activityId: string | null;
      context: any | null;
      thoughts: any | null;
      userId: string | null;
      conversationId: string;
    }[];
  } & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    deleted: Date | null;
    unread: boolean;
    source: string;
    title: string | null;
    userId: string;
    workspaceId: string | null;
    status: string;
  };
  onComplete: () => void;
}

export function OnboardingChat({
  conversation,
  onboardingSummary,
}: OnboardingChatProps) {
  const hasSentInitialMessage = useRef(false);

  const { sendMessage, messages, status, stop, addToolApprovalResponse } =
    useChat({
      id: conversation.id,
      messages: conversation.ConversationHistory.map(
        (history: any) =>
          ({
            id: history.id,
            role:
              history.userType === UserTypeEnum.Agent ? "assistant" : "user",
            parts: history.parts
              ? history.parts
              : [{ text: history.message, type: "text" }],
          }) as UIMessage & { createdAt: string },
      ),
      transport: new DefaultChatTransport({
        api: "/api/v1/conversation",
        prepareSendMessagesRequest({ messages, id }) {
          // Check if the last assistant message needs approval
          const lastAssistantMessage = [...messages]
            .reverse()
            .find((msg) => msg.role === "assistant") as UIMessage | undefined;

          const needsApproval = !!lastAssistantMessage?.parts.find(
            (part: any) => part.state === "approval-responded",
          );

          if (needsApproval) {
            return { body: { messages, needsApproval: true, id } };
          }

          // For onboarding, always include the flags and summary
          return {
            body: {
              message: messages[messages.length - 1],
              id,
              isOnboarding: true,
              onboardingSummary,
            },
          };
        },
      }),
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  // Send initial message on component mount
  useEffect(() => {
    if (!hasSentInitialMessage.current && status === "ready") {
      hasSentInitialMessage.current = true;
      sendMessage({ text: "what can you help me with?" });
    }
  }, [sendMessage, status]);

  // Check if the last assistant message needs approval
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant") as UIMessage | undefined;

  const needsApproval = !!lastAssistantMessage?.parts.find(
    (part: any) => part.state === "approval-requested",
  );

  return (
    <div className="flex h-full w-full flex-col justify-end overflow-hidden py-4 pt-0 pb-12 lg:pb-4">
      <ScrollAreaWithAutoScroll>
        {messages
          .filter((message: UIMessage, index: number) => {
            // Hide the first user message
            return !(index === 0 && message.role === "user");
          })
          .map((message: UIMessage, index: number) => {
            return (
              <ConversationItem
                key={index}
                message={message}
                addToolApprovalResponse={addToolApprovalResponse}
              />
            );
          })}
      </ScrollAreaWithAutoScroll>

      <div className="flex w-full flex-col items-center">
        <div className="w-full max-w-[90ch] px-1 pr-2">
          <ConversationTextarea
            className="bg-background-3 w-full border-1 border-gray-300"
            isLoading={status === "streaming" || status === "submitted"}
            disabled={needsApproval}
            onConversationCreated={(message) => {
              if (message) {
                sendMessage({ text: message });
              }
            }}
            stop={() => stop()}
          />
        </div>
      </div>
    </div>
  );
}

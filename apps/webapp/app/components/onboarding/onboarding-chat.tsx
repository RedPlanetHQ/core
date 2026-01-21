import { type UIMessage, useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  ConversationItem,
  ConversationTextarea,
} from "~/components/conversation";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";

interface OnboardingChatProps {
  conversationId: string;
  onboardingSummary: string;
  onComplete: () => void;
}

export function OnboardingChat({
  conversationId,
  onboardingSummary,
}: OnboardingChatProps) {
  console.log(onboardingSummary);
  const { sendMessage, messages, status, stop, addToolApprovalResponse } =
    useChat({
      id: conversationId,
      messages: [],
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

  // Check if the last assistant message needs approval
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant") as UIMessage | undefined;

  const needsApproval = !!lastAssistantMessage?.parts.find(
    (part: any) => part.state === "approval-requested",
  );

  return (
    <div className="flex h-full w-full flex-col justify-end overflow-hidden py-4 pb-12 lg:pb-4">
      <ScrollAreaWithAutoScroll>
        {messages.map((message: UIMessage, index: number) => {
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

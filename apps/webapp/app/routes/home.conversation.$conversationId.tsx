import { type LoaderFunctionArgs } from "@remix-run/server-runtime";

import { useParams, useNavigate } from "@remix-run/react";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { getConversationAndHistory } from "~/services/conversation.server";
import {
  ConversationItem,
  ConversationTextarea,
} from "~/components/conversation";
import { useTypedLoaderData } from "remix-typedjson";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";
import { PageHeader } from "~/components/common/page-header";
import { Plus } from "lucide-react";

import { type UIMessage, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { UserTypeEnum } from "@core/types";
import React from "react";

// Example loader accessing params
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  const conversation = await getConversationAndHistory(
    params.conversationId as string,
    user.id,
  );

  if (!conversation) {
    throw new Error("No conversation found");
  }

  return { conversation };
}

// Accessing params in the component
export default function SingleConversation() {
  const { conversation } = useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const { sendMessage, messages, status, stop, regenerate } = useChat({
    id: conversationId, // use the provided chat ID
    messages: conversation.ConversationHistory.map(
      (history) =>
        ({
          role: history.userType === UserTypeEnum.Agent ? "assistant" : "user",
          parts: [{ text: history.message, type: "text" }],
        }) as UIMessage,
    ), // load initial messages
    transport: new DefaultChatTransport({
      api: "/api/v1/conversation",
      prepareSendMessagesRequest({ messages, id }) {
        return { body: { message: messages[messages.length - 1], id } };
      },
    }),
  });

  React.useEffect(() => {
    if (messages.length === 1) {
      regenerate();
    }
  }, []);

  if (typeof window === "undefined") {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Conversation"
        breadcrumbs={[
          { label: "Conversations", href: "/home/conversation" },
          { label: conversation.title || "Untitled" },
        ]}
        actions={[
          {
            label: "New conversation",
            icon: <Plus size={14} />,
            onClick: () => navigate("/home/conversation"),
            variant: "secondary",
          },
        ]}
      />

      <div className="relative flex h-[calc(100vh_-_56px)] w-full flex-col items-center justify-center overflow-auto">
        <div className="flex h-[calc(100vh_-_80px)] w-full flex-col justify-end overflow-hidden">
          <ScrollAreaWithAutoScroll>
            {messages.map((message: UIMessage, index: number) => {
              return <ConversationItem key={index} message={message} />;
            })}
          </ScrollAreaWithAutoScroll>

          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-[80ch] px-1 pr-2">
              <ConversationTextarea
                className="bg-background-3 w-full border-1 border-gray-300"
                isLoading={status === "streaming" || status === "submitted"}
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
      </div>
    </>
  );
}

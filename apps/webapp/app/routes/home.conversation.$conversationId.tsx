import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { sort } from "fast-sort";

import { useParams, useRevalidator, useNavigate } from "@remix-run/react";
import { requireUser, requireWorkpace } from "~/services/session.server";
import {
  getConversationAndHistory,
  getCurrentConversationRun,
  stopConversation,
} from "~/services/conversation.server";
import { type ConversationHistory } from "@core/database";
import {
  ConversationItem,
  ConversationTextarea,
  StreamingConversation,
} from "~/components/conversation";
import { useTypedLoaderData } from "remix-typedjson";
import React from "react";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";
import { PageHeader } from "~/components/common/page-header";
import { Plus } from "lucide-react";

import { json } from "@remix-run/node";
import { env } from "~/env.server";

// Example loader accessing params
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const conversation = await getConversationAndHistory(
    params.conversationId as string,
    user.id,
  );

  if (!conversation) {
    throw new Error("No conversation found");
  }

  const run = await getCurrentConversationRun(conversation.id, workspace.id);

  return { conversation, run, apiURL: env.TRIGGER_API_URL };
}

// Example action accessing params
export async function action({ params, request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const workspace = await requireWorkpace(request);
  // params.conversationId will be available here
  const { conversationId } = params;

  if (!conversationId) {
    throw new Error("No conversation");
  }

  const result = await stopConversation(conversationId, workspace.id);
  return json(result);
}

// Accessing params in the component
export default function SingleConversation() {
  const { conversation, run, apiURL } = useTypedLoaderData<typeof loader>();
  const conversationHistory = conversation.ConversationHistory;

  const [conversationResponse, setConversationResponse] = React.useState<
    { conversationHistoryId: string; id: string; token: string } | undefined
  >(run);

  const { conversationId } = useParams();
  const revalidator = useRevalidator();

  const navigate = useNavigate();

  React.useEffect(() => {
    if (run) {
      setConversationResponse(run);
    }
  }, [run]);

  const getConversations = () => {
    const lastConversationHistoryId =
      conversationResponse?.conversationHistoryId;

    // First sort the conversation history by creation time
    const sortedConversationHistory = sort(conversationHistory).asc(
      (ch) => ch.createdAt,
    );

    const lastIndex = sortedConversationHistory.findIndex(
      (item) => item.id === lastConversationHistoryId,
    );

    // Filter out any conversation history items that come after the lastConversationHistoryId
    const filteredConversationHistory = lastConversationHistoryId
      ? sortedConversationHistory.filter((_ch, currentIndex: number) => {
          // Find the index of the last conversation history

          // Only keep items that come before or are the last conversation history
          return currentIndex <= lastIndex;
        })
      : sortedConversationHistory;

    return (
      <>
        {filteredConversationHistory.map(
          (ch: ConversationHistory, index: number) => {
            return <ConversationItem key={index} conversationHistory={ch} />;
          },
        )}
      </>
    );
  };

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
            {getConversations()}
            {conversationResponse && (
              <StreamingConversation
                runId={conversationResponse.id}
                token={conversationResponse.token}
                afterStreaming={() => {
                  setConversationResponse(undefined);
                  revalidator.revalidate();
                }}
                apiURL={apiURL}
              />
            )}
          </ScrollAreaWithAutoScroll>

          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-[97ch] px-1 pr-2">
              {conversation?.status !== "need_approval" && (
                <ConversationTextarea
                  conversationId={conversationId as string}
                  className="bg-background-3 w-full border-1 border-gray-300"
                  isLoading={
                    !!conversationResponse || conversation?.status === "running"
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

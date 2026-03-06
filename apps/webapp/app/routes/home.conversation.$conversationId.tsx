import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";

import { useParams, useNavigate, useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import {
  getConversationAndHistory,
  readConversation,
  deleteConversation,
} from "~/services/conversation.server";
import {
  ConversationItem,
  ConversationTextarea,
} from "~/components/conversation";
import { hasNeedsApprovalDeep } from "~/components/conversation/conversation-utils";
import { useTypedLoaderData } from "remix-typedjson";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";
import { PageHeader } from "~/components/common/page-header";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

import { type UIMessage, useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
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

  if (conversation.unread) {
    await readConversation(conversation.id);
  }

  return { conversation };
}

export async function action({ params, request }: ActionFunctionArgs) {
  await requireUser(request);
  await deleteConversation(params.conversationId as string);
  return { deleted: true };
}

// Accessing params in the component
export default function SingleConversation() {
  const { conversation } = useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const fetcher = useFetcher();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  React.useEffect(() => {
    if (fetcher.data && (fetcher.data as any).deleted) {
      navigate("/home/conversation");
    }
  }, [fetcher.data]);

  const {
    sendMessage,
    messages,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId, // use the provided chat ID
    messages: conversation.ConversationHistory.map(
      (history) =>
        ({
          id: history.id,
          role: history.userType === UserTypeEnum.Agent ? "assistant" : "user",
          parts: history.parts
            ? history.parts
            : [{ text: history.message, type: "text" }],
        }) as UIMessage & { createdAt: string },
    ), // load initial messages
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
        return { body: { message: messages[messages.length - 1], id } };
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  React.useEffect(() => {
    if (conversation.ConversationHistory.length === 1) {
      regenerate();
    }
  }, []);

  // Check if the last assistant message needs approval (including nested sub-agents)
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant") as UIMessage | undefined;

  const needsApproval = lastAssistantMessage?.parts
    ? hasNeedsApprovalDeep(lastAssistantMessage.parts)
    : false;

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
            label: "Delete",
            icon: <Trash2 size={14} />,
            onClick: () => setShowDeleteDialog(true),
            variant: "secondary",
          },
        ]}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => fetcher.submit({}, { method: "DELETE" })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="relative flex h-[calc(100vh)] w-full flex-col items-center justify-center overflow-auto md:h-[calc(100vh_-_56px)]">
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
                className="bg-background-3 border-1 w-full border-gray-300"
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
      </div>
    </>
  );
}

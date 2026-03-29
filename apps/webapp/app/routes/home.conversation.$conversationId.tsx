import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { Memory } from "@mastra/memory";

import { useParams, useNavigate, useFetcher } from "@remix-run/react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getConversationAndHistory,
  readConversation,
  deleteConversation,
} from "~/services/conversation.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getAvailableModels } from "~/services/llm-provider.server";
import { ConversationView } from "~/components/conversation";
import { useTypedLoaderData } from "remix-typedjson";
import { PageHeader } from "~/components/common/page-header";
import { Trash2, EyeOff } from "lucide-react";
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
import React from "react";

import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
// Example loader accessing params
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const [conversation, integrationAccounts, allModels] = await Promise.all([
    getConversationAndHistory(params.conversationId as string, user.id),
    getIntegrationAccounts(user.id, workspaceId),
    getAvailableModels(),
  ]);

  const models = allModels
    .filter(
      (m) => m.capabilities.length === 0 || m.capabilities.includes("chat"),
    )
    .map((m) => ({
      id: `${m.provider.type}/${m.modelId}`,
      modelId: m.modelId,
      label: m.label,
      provider: m.provider.type,
      isDefault: m.isDefault,
    }));

  if (!conversation) {
    return { conversation: null, integrationAccountMap: {}, models };
  }

  if (conversation.unread) {
    await readConversation(conversation.id);
  }

  const integrationAccountMap: Record<string, string> = {};
  const integrationFrontendMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
    if (acc.integrationDefinition.frontendUrl) {
      integrationFrontendMap[acc.id] = acc.integrationDefinition.frontendUrl;
    }
  }

  return { conversation, integrationAccountMap, integrationFrontendMap, models };
}

export async function action({ params, request }: ActionFunctionArgs) {
  await requireUser(request);
  await deleteConversation(params.conversationId as string);
  return { deleted: true };
}

export default function SingleConversation() {
  const { conversation, integrationAccountMap, integrationFrontendMap, models } =
    useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const fetcher = useFetcher();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  React.useEffect(() => {
    if (fetcher.data && (fetcher.data as any).deleted) {
      navigate("/home/conversation");
    }
  }, [fetcher.data]);

  if (typeof window === "undefined") return null;

  if (!conversation) {
    return (
      <div className="flex h-[calc(100vh)] w-full items-center justify-center md:h-[calc(100vh_-_16px)]">
        <p className="text-muted-foreground text-sm">No conversation found</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Conversation"
        breadcrumbs={[
          { label: "Conversations", href: "/home/conversation" },
          {
            label: (
              <span className="flex items-center gap-1.5">
                {conversation.title
                  ? conversation.title.replace(/<[^>]*>/g, "").trim() ||
                    "Untitled"
                  : "Untitled"}
                {conversation.incognito && (
                  <EyeOff
                    size={13}
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </span>
            ),
          },
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
        <ConversationView
          conversationId={conversationId as string}
          history={conversation.ConversationHistory}
          integrationAccountMap={integrationAccountMap}
          integrationFrontendMap={integrationFrontendMap}
          conversationStatus={conversation.status}
          models={models}
          autoRegenerate
        />
      </div>
    </>
  );
}

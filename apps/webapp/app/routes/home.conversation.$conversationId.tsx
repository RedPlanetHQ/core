import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/server-runtime";
import { Memory } from "@mastra/memory";
import { useParams, useNavigate, useFetcher, Link } from "@remix-run/react";

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

import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.conversation?.title;
  return [{ title: title ? `${title} | Chat` : "Chat" }];
};

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

  return {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
  };
}

export async function action({ params, request }: ActionFunctionArgs) {
  await requireUser(request);
  await deleteConversation(params.conversationId as string);
  return { deleted: true };
}

export default function SingleConversation() {
  const {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
  } = useTypedLoaderData<typeof loader>();
  const { conversationId } = useParams();

  if (typeof window === "undefined") return null;

  if (!conversation) {
    return (
      <div className="flex h-[calc(100vh)] w-full flex-col items-center justify-center gap-4 md:h-[calc(100vh_-_16px)]">
        <p className="text-muted-foreground text-sm">
          This conversation is no longer available.
        </p>
        <div className="flex gap-3">
          <Link
            to="/home/conversation"
            className="text-sm underline underline-offset-4"
          >
            Back to conversations
          </Link>
          <Link
            to="/home/conversation/new"
            className="text-sm underline underline-offset-4"
          >
            Start a new conversation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-page relative flex w-full flex-col items-center justify-center overflow-hidden">
      <ConversationView
        key={conversationId as string}
        conversationId={conversationId as string}
        history={conversation.ConversationHistory}
        integrationAccountMap={integrationAccountMap}
        integrationFrontendMap={integrationFrontendMap}
        conversationStatus={conversation.status}
        models={models}
        autoRegenerate
        hideFirstUserMessage={conversation.source === "onboarding"}
      />
    </div>
  );
}

import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { type MetaFunction } from "@remix-run/node";
import { useParams, Link } from "@remix-run/react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getConversationHistoryPage,
  readConversation,
  deleteConversation,
} from "~/services/conversation.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getChatComposerModels } from "~/services/llm-provider.server";
import { listAgents, readAgentAppearance } from "~/services/agent.server";
import { ConversationView } from "~/components/conversation";
import { useTypedLoaderData } from "remix-typedjson";
import type { LoaderData } from "~/utils/loader-data";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.conversation?.title;
  return [{ title: title ? `${title} | Chat` : "Chat" }];
};

/**
 * `/home/conversation/c/<conversationId>` — direct-view of a specific
 * Conversation row. Used for links that already know the concrete
 * conversation to open (task run "Open chat", command-bar jump, unread
 * conversation entries, etc.) rather than the agent-handle-based endless
 * thread route at `/home/conversation/<handle>`.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const initialVoiceMode =
    new URL(request.url).searchParams.get("voice") === "1";

  const [conversation, integrationAccounts, models, agents] = await Promise.all([
    // Newest page only — the client pages backwards as you scroll up.
    getConversationHistoryPage(params.conversationId as string, user.id),
    getIntegrationAccounts(user.id, workspaceId),
    getChatComposerModels(workspaceId),
    // Active agents for the composer's @-mention picker. `handle` is what
    // the backend parser resolves against; `displayName` is what the
    // picker renders.
    listAgents(workspaceId, { status: "Active" }),
  ]);

  // Full agent badges: `handle` powers the composer's @-mention picker;
  // `id` + `appearance` power the per-message sender avatar/name header
  // in ConversationView. Gateway-backed rows are filtered out — infra,
  // not chatteable.
  const colleagues = agents
    .filter((a) => {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      return meta.gatewaySource !== true;
    })
    .map((a) => ({
      id: a.id,
      handle: a.handle,
      displayName: a.displayName,
      appearance: readAgentAppearance(a),
    }));

  if (!conversation) {
    return {
      conversation: null,
      integrationAccountMap: {},
      integrationFrontendMap: {},
      models,
      colleagues,
      enableMentionPicker: false,
      initialVoiceMode,
    };
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

  // Collaboration (and the @-mention picker) is enabled only for
  // task-scoped conversations. Agent 1:1 chats stay 1:1.
  const enableMentionPicker =
    conversation.source === "task" || !!conversation.asyncJobId;

  return {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
    colleagues,
    enableMentionPicker,
    initialVoiceMode,
  };
}

export async function action({ params, request }: ActionFunctionArgs) {
  await requireUser(request);
  await deleteConversation(params.conversationId as string);
  return { deleted: true };
}

export default function DirectConversation() {
  const {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
    colleagues,
    enableMentionPicker,
    initialVoiceMode,
  } = useTypedLoaderData<typeof loader>() as unknown as LoaderData<
    typeof loader
  >;
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
        hasMore={conversation.hasMore}
        nextCursor={conversation.nextCursor}
        integrationAccountMap={integrationAccountMap}
        integrationFrontendMap={integrationFrontendMap}
        conversationStatus={conversation.status}
        models={models}
        colleagues={colleagues}
        enableMentionPicker={enableMentionPicker}
        autoRegenerate
        hideFirstUserMessage={conversation.source === "onboarding"}
        initialVoiceMode={initialVoiceMode}
      />
    </div>
  );
}

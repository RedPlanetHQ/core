import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { type MetaFunction, redirect } from "@remix-run/node";
import { useParams, Link } from "@remix-run/react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getConversationHistoryPage,
  readConversation,
  deleteConversation,
  getOrCreateAgentConversation,
} from "~/services/conversation.server";
import {
  getAgentByHandle,
  listAgents,
  readAgentAppearance,
} from "~/services/agent.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getChatComposerModels } from "~/services/llm-provider.server";
import { ConversationView } from "~/components/conversation";
import { useTypedLoaderData } from "remix-typedjson";
import type { LoaderData } from "~/utils/loader-data";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const agentName = data?.agentName;
  return [{ title: agentName ? `${agentName} | Chat` : "Chat" }];
};

/**
 * `/home/conversation/<agent_handle>` — the single endless-scroll thread for
 * the workspace's chosen agent. On first visit for a given (workspace, user,
 * agent) we materialize an empty Conversation row and land in it; every
 * subsequent hit reuses the same row.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const handle = params.handle;
  if (!handle) throw redirect("/home/conversation");

  const agent = await getAgentByHandle(workspaceId, handle);
  if (!agent) {
    // Unknown handle — bounce to bare /home/conversation so it can re-resolve
    // to the workspace generalist rather than dumping the user on a 404.
    throw redirect("/home/conversation");
  }

  // Which per-source thread are we opening? Defaults to the dashboard's
  // core chat; History popover deep-links to other sources via ?src=<name>.
  const url = new URL(request.url);
  const source = url.searchParams.get("src") ?? "core";

  const { conversationId } = await getOrCreateAgentConversation(
    workspaceId,
    user.id,
    agent.id,
    source,
  );

  const initialVoiceMode = url.searchParams.get("voice") === "1";
  // Optional composer prefill via ?msg=… — command-bar affordances like
  // "Add Task" deep-link into a specific agent's thread with a starter
  // phrase already typed.
  const defaultMessage = url.searchParams.get("msg") ?? undefined;

  // Newest page only. These threads are endless — an integration-fed source
  // accumulates every event ever pushed — so first paint takes the tail and
  // the client pages backwards from there.
  const [conversation, integrationAccounts, models, agents] = await Promise.all([
    getConversationHistoryPage(conversationId, user.id),
    getIntegrationAccounts(user.id, workspaceId),
    getChatComposerModels(workspaceId),
    listAgents(workspaceId, { status: "Active" }),
  ]);

  // Full agent badges for the ConversationView sender-attribution
  // header. Includes appearance so SamAvatar can render. Filter out
  // gateway-backed agents — infrastructure, not chatteable authors.
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
    // Extraordinarily rare — the row we just fetched/created is gone.
    return {
      conversation: null,
      agentName: agent.displayName,
      integrationAccountMap: {},
      integrationFrontendMap: {},
      models,
      colleagues,
      initialVoiceMode,
      defaultMessage,
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

  return {
    conversation,
    agentName: agent.displayName,
    integrationAccountMap,
    integrationFrontendMap,
    models,
    colleagues,
    initialVoiceMode,
    defaultMessage,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const url = new URL(request.url);
  const handle = url.pathname.split("/").pop() ?? "";
  const agent = handle ? await getAgentByHandle(workspaceId, handle) : null;
  if (!agent) return { deleted: false };

  const { conversationId } = await getOrCreateAgentConversation(
    workspaceId,
    user.id,
    agent.id,
  );
  await deleteConversation(conversationId);
  return { deleted: true };
}

export default function AgentConversation() {
  const {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
    colleagues,
    initialVoiceMode,
    defaultMessage,
  } = useTypedLoaderData<typeof loader>() as unknown as LoaderData<typeof loader>;
  const { handle } = useParams();

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
        key={handle as string}
        conversationId={conversation.id}
        history={conversation.ConversationHistory}
        hasMore={conversation.hasMore}
        nextCursor={conversation.nextCursor}
        integrationAccountMap={integrationAccountMap}
        integrationFrontendMap={integrationFrontendMap}
        conversationStatus={conversation.status}
        models={models}
        colleagues={colleagues}
        autoRegenerate
        hideFirstUserMessage={conversation.source === "onboarding"}
        initialVoiceMode={initialVoiceMode}
        defaultMessage={defaultMessage}
      />
    </div>
  );
}

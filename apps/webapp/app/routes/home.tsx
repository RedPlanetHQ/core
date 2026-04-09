import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { requireUser, requireWorkpace } from "~/services/session.server";

import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { clearRedirectTo, commitSession } from "~/services/redirectTo.server";

import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";

import { json, redirect } from "@remix-run/node";
import { onboardingPath } from "~/utils/pathBuilder";
import { getConversationSources } from "~/services/conversation.server";
import { prisma } from "~/db.server";
import { SetButlerNameModal } from "~/components/onboarding/set-butler-name-modal";
import { ClientOnly } from "remix-utils/client-only";
import { GlobalChatPanel } from "~/components/chat-panel/global-chat-panel.client";
import { CollabSocketProvider } from "~/components/editor/collab-socket-context";
import {
  ChatPanelProvider,
  useChatPanel,
} from "~/components/chat-panel/chat-panel-context";
import React from "react";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import {
  getAvailableModels,
  isBurstSensitiveChatProvider,
} from "~/services/llm-provider.server";
import { type LLMModel } from "~/components/conversation";
import { tinykeys } from "tinykeys";

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    return json({ error: "No workspace" }, { status: 400 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;

  if (!name || !slug) {
    return json({ error: "name and slug are required" }, { status: 400 });
  }

  const existing = await prisma.workspace.findFirst({
    where: { id: workspaceId },
    select: { metadata: true },
  });
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      name,
      slug,
      metadata: { ...existingMeta, onboardingV2Complete: true },
    },
  });

  return json({ ok: true });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  if (!workspace) {
    return { conversationSources: [] };
  }

  const conversationSources = await getConversationSources(
    workspace.id,
    user.id,
  );

  const [integrationAccounts, allModels] = await Promise.all([
    getIntegrationAccounts(user.id, workspace?.id as string),
    getAvailableModels(),
  ]);
  const enableBurstSafeReplyRecovery = isBurstSensitiveChatProvider();

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

  const integrationAccountMap: Record<string, string> = {};
  const integrationFrontendMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
    if (acc.integrationDefinition.frontendUrl) {
      integrationFrontendMap[acc.id] = acc.integrationDefinition.frontendUrl;
    }
  }

  if (!user.onboardingComplete) {
    return redirect(onboardingPath());
  } else {
    return typedjson(
      {
        user,
        workspace,
        conversationSources,
        models,
        integrationAccountMap,
        integrationFrontendMap,
        enableBurstSafeReplyRecovery,
      },
      {
        headers: {
          "Set-Cookie": await commitSession(await clearRedirectTo(request)),
        },
      },
    );
  }
};

function HomeInner({
  conversationSources,
  workspace,
  meta,
  agentName,
  accentColor,
  needsButlerName,
  models,
  integrationAccountMap,
  enableBurstSafeReplyRecovery,
}: {
  conversationSources: any;
  workspace: any;
  meta: Record<string, unknown>;
  agentName: string;
  accentColor: string;
  needsButlerName: boolean;
  models: LLMModel[];
  integrationAccountMap: Record<string, string>;
  enableBurstSafeReplyRecovery: boolean;
}) {
  const { panelRef, closeChat, onPanelCollapse, chatOpen, toggleChat } =
    useChatPanel()!;
  const location = useLocation();
  const isConversationRoute = location.pathname.startsWith("/home/conversation");

  React.useEffect(() => {
    if (isConversationRoute) return;

    const whenNotEditing = (fn: () => void) => (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      fn();
    };

    return tinykeys(window, {
      "$mod+j": whenNotEditing(() => toggleChat()),
    });
  }, [isConversationRoute, toggleChat]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 52)",
          "--header-height": "calc(var(--spacing) * 12)",
          background: "var(--background)",
        } as React.CSSProperties
      }
    >
      {needsButlerName && (
        <SetButlerNameModal
          defaultName={workspace.name}
          defaultSlug={workspace.slug}
          workspaceId={workspace.id}
        />
      )}
      <AppSidebar
        conversationSources={conversationSources}
        widgetsEnabled={!!meta.widgetsEnabled}
        agentName={agentName}
        accentColor={accentColor}
      />
      <SidebarInset className="bg-background-2 h-full rounded pr-0">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="100%" minSize="50%">
            <div className="flex h-full flex-col rounded">
              <div className="flex h-full flex-col gap-2 @container/main">
                <div className="flex h-full flex-col">
                  <Outlet />
                </div>
              </div>
            </div>
          </ResizablePanel>

          {!isConversationRoute && <ResizableHandle withHandle />}

          {chatOpen && !isConversationRoute && (
            <ResizablePanel
              ref={panelRef}
              defaultSize="50%"
              minSize="30%"
              maxSize="50%"
              collapsible
              collapsedSize={0}
              onCollapse={onPanelCollapse}
            >
              <ClientOnly fallback={null}>
                {() => (
                  <GlobalChatPanel
                    agentName={agentName}
                    onClose={closeChat}
                    models={models}
                    integrationAccountMap={integrationAccountMap}
                    enableBurstSafeReplyRecovery={enableBurstSafeReplyRecovery}
                  />
                )}
              </ClientOnly>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function Home() {
  const {
    conversationSources,
    workspace,
    models,
    integrationAccountMap,
    enableBurstSafeReplyRecovery,
  } = useLoaderData<typeof loader>() as any;
  const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  const needsButlerName = !meta.onboardingV2Complete;
  const accentColor = (meta.accentColor as string) || "#c87844";
  const agentName = (workspace?.name as string) ?? "butler";

  return (
    <CollabSocketProvider>
      <ChatPanelProvider>
        <HomeInner
          conversationSources={conversationSources}
          workspace={workspace}
          meta={meta}
          agentName={agentName}
          accentColor={accentColor}
          needsButlerName={needsButlerName}
          models={models}
          integrationAccountMap={integrationAccountMap}
          enableBurstSafeReplyRecovery={enableBurstSafeReplyRecovery}
        />
      </ChatPanelProvider>
    </CollabSocketProvider>
  );
}

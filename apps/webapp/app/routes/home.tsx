import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { requireUser, requireWorkpace } from "~/services/session.server";

import { Outlet, useLoaderData } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { clearRedirectTo, commitSession } from "~/services/redirectTo.server";

import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { ResizablePanelGroup, ResizablePanel } from "~/components/ui/resizable";

import { json, redirect } from "@remix-run/node";
import { onboardingPath } from "~/utils/pathBuilder";
import { getConversationSources } from "~/services/conversation.server";
import { prisma } from "~/db.server";
import { SetButlerNameModal } from "~/components/onboarding/set-butler-name-modal";
import { UpgradeRequiredModal } from "~/components/onboarding/upgrade-required-modal";
import { isBillingEnabled } from "~/config/billing.server";
import { isWorkspaceBYOK } from "~/services/byok.server";
import { CollabSocketProvider } from "~/components/editor/collab-socket-context";
import React from "react";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getChatComposerModels } from "~/services/llm-provider.server";
import { type LLMModel } from "~/components/conversation";
import { useTauri } from "~/hooks/use-tauri";
import { DesktopTabsProvider } from "~/components/desktop/tabs-context";
import { DesktopTabBar } from "~/components/desktop/tab-bar";

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    return json({ error: "No workspace" }, { status: 400 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const agentEye = (formData.get("agentEye") as string) || undefined;
  const agentEyeColor = (formData.get("agentEyeColor") as string) || undefined;

  if (!name || !slug) {
    return json({ error: "name and slug are required" }, { status: 400 });
  }

  const existing = await prisma.workspace.findFirst({
    where: { id: workspaceId },
    select: { metadata: true },
  });
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const nextMeta: Record<string, unknown> = {
    ...existingMeta,
    onboardingV2Complete: true,
  };
  if (agentEye) nextMeta.agentEye = agentEye;
  if (agentEyeColor) nextMeta.agentEyeColor = agentEyeColor;

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      name,
      slug,
      metadata: nextMeta,
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

  const [integrationAccounts, models] = await Promise.all([
    getIntegrationAccounts(user.id, workspace?.id as string),
    getChatComposerModels(workspace?.id),
  ]);

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
  }

  const userMeta = (user.metadata ?? {}) as Record<string, unknown>;
  if (!userMeta.planStepComplete) {
    return redirect("/onboarding/plan");
  }

  // Hard paywall for FREE users who haven't set up BYOK. The plan step
  // marks them complete on click but doesn't guarantee they finished
  // Stripe / added a key — this catches those drop-offs on every /home hit.
  let needsUpgrade = false;
  if (isBillingEnabled() && workspace.id) {
    const [subscription, hasByok] = await Promise.all([
      prisma.subscription.findUnique({
        where: { workspaceId: workspace.id },
        select: { planType: true },
      }),
      isWorkspaceBYOK(workspace.id),
    ]);


    const planType = subscription?.planType ?? "FREE";
    needsUpgrade = planType === "FREE" && !hasByok;
  }

  return typedjson(
    {
      user,
      workspace,
      conversationSources,
      models,
      integrationAccountMap,
      integrationFrontendMap,
      needsUpgrade,
    },
    {
      headers: {
        "Set-Cookie": await commitSession(await clearRedirectTo(request)),
      },
    },
  );
};

function HomeInner({
  conversationSources,
  workspace,
  meta,
  agentName,
  accentColor,
  needsButlerName,
  needsUpgrade,
  models,
  integrationAccountMap,
}: {
  conversationSources: any;
  workspace: any;
  meta: Record<string, unknown>;
  agentName: string;
  accentColor: string;
  needsButlerName: boolean;
  needsUpgrade: boolean;
  models: LLMModel[];
  integrationAccountMap: Record<string, string>;
}) {
  const { isDesktop } = useTauri();

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
      {needsUpgrade && <UpgradeRequiredModal />}
      <AppSidebar
        conversationSources={conversationSources}
        widgetsEnabled={!!meta.widgetsEnabled}
        agentName={agentName}
        accentColor={accentColor}
      />
      <SidebarInset className="h-[calc(100vh_-_16px)] border-none bg-transparent pr-0 !shadow-none outline-none">
        {isDesktop && (
          <div className="flex w-full flex-col overflow-hidden">
            <DesktopTabBar />
          </div>
        )}
        <ResizablePanelGroup
          orientation="horizontal"
          className="bg-background-2 shadow-1 border-border h-page-xs !rounded-xl"
        >
          <ResizablePanel defaultSize="100%" minSize="50%">
            <div className="flex h-full flex-col">
              <div className="flex h-full flex-col gap-2 @container/main">
                <div className="flex h-full flex-col">
                  <Outlet />
                </div>
              </div>
            </div>
          </ResizablePanel>
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
    needsUpgrade,
  } = useLoaderData<typeof loader>() as any;
  const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  const needsButlerName = !meta.onboardingV2Complete;
  const accentColor = (meta.accentColor as string) || "#c87844";
  const agentName = (workspace?.name as string) ?? "butler";

  return (
    <CollabSocketProvider>
      <DesktopTabsProvider>
        <HomeInner
          conversationSources={conversationSources}
          workspace={workspace}
          meta={meta}
          agentName={agentName}
          accentColor={accentColor}
          needsButlerName={needsButlerName}
          needsUpgrade={!!needsUpgrade}
          models={models}
          integrationAccountMap={integrationAccountMap}
        />
      </DesktopTabsProvider>
    </CollabSocketProvider>
  );
}

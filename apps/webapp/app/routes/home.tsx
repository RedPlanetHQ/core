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

import { json, redirect } from "@remix-run/node";
import { onboardingPath } from "~/utils/pathBuilder";
import { getConversationSources } from "~/services/conversation.server";
import { prisma } from "~/db.server";
import { SetButlerNameModal } from "~/components/onboarding/set-butler-name-modal";

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

  if (!user.onboardingComplete) {
    return redirect(onboardingPath());
  } else {
    return typedjson(
      {
        user,
        workspace,
        conversationSources,
      },
      {
        headers: {
          "Set-Cookie": await commitSession(await clearRedirectTo(request)),
        },
      },
    );
  }
};

export default function Home() {
  const { conversationSources, workspace } = useLoaderData<
    typeof loader
  >() as any;
  const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  const needsButlerName = !meta.onboardingV2Complete;

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 56)",
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
      />
      <SidebarInset className="bg-background-2 h-full rounded pr-0">
        <div className="flex h-full flex-col rounded">
          <div className="flex h-full flex-col gap-2 @container/main">
            <div className="flex h-full flex-col">
              <Outlet />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

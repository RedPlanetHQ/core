import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUser, requireWorkpace } from "~/services/session.server";

import { Outlet, useLoaderData } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { clearRedirectTo, commitSession } from "~/services/redirectTo.server";

import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

import { redirect } from "@remix-run/node";
import { confirmBasicDetailsPath, onboardingPath } from "~/utils/pathBuilder";
import { LabelService } from "~/services/label.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const labelService = new LabelService();
  const labels = await labelService.getWorkspaceLabels(workspace.id);

  //you have to confirm basic details before you can do anything
  if (!user.confirmedBasicDetails) {
    return redirect(confirmBasicDetailsPath());
  } else if (!user.onboardingComplete) {
    return redirect(onboardingPath());
  } else {
    return typedjson(
      {
        user,
        workspace,
        labels,
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
  const { labels } = useLoaderData<typeof loader>();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 54)",
          "--header-height": "calc(var(--spacing) * 12)",
          background: "var(--background)",
        } as React.CSSProperties
      }
    >
      <AppSidebar labels={labels} />
      <SidebarInset className="bg-background-2 h-full rounded pr-0">
        <div className="flex h-full flex-col rounded">
          <div className="@container/main flex h-full flex-col gap-2">
            <div className="flex h-full flex-col">
              <Outlet />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

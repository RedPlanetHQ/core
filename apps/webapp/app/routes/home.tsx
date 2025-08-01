import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUser, requireWorkpace } from "~/services/session.server";

import { Outlet } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { clearRedirectTo, commitSession } from "~/services/redirectTo.server";

import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { FloatingIngestionStatus } from "~/components/ingestion/floating-ingestion-status";
import { redirect } from "@remix-run/node";
import { confirmBasicDetailsPath, onboardingPath } from "~/utils/pathBuilder";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

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
      <AppSidebar variant="inset" />
      <SidebarInset className="bg-background-2 h-full rounded pr-0">
        <div className="flex h-full flex-col rounded">
          <div className="@container/main flex h-full flex-col gap-2">
            <div className="flex h-full flex-col">
              <Outlet />
            </div>
          </div>
        </div>
        <FloatingIngestionStatus />
      </SidebarInset>
    </SidebarProvider>
  );
}

import {
  ArrowLeft,
  Brain,
  Building,
  Clock,
  Code,
  User,
  Workflow,
  Webhook,
} from "lucide-react";

import React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar";
import { Button } from "~/components/ui";
import { cn } from "~/lib/utils";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { typedjson } from "remix-typedjson";
import { clearRedirectTo, commitSession } from "~/services/redirectTo.server";
import { Outlet, useLocation, useNavigate } from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

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
};

export default function Settings() {
  const location = useLocation();

  const data = {
    nav: [
      // { name: "Workspace", icon: Building },
      { name: "API", icon: Code },
      { name: "Webhooks", icon: Webhook },
    ],
  };
  const navigate = useNavigate();

  const gotoHome = () => {
    navigate("/home/conversation");
  };

  return (
    <div className="bg-background h-full w-full overflow-hidden p-0">
      <SidebarProvider className="items-start">
        <Sidebar collapsible="none" className="hidden w-[180px] md:flex">
          <SidebarHeader className="flex justify-start pb-0">
            <Button
              variant="link"
              className="flex w-fit gap-2"
              onClick={gotoHome}
            >
              <ArrowLeft size={14} />
              Back to app
            </Button>
          </SidebarHeader>
          <SidebarContent className="bg-background">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {data.nav.map((item) => (
                    <SidebarMenuItem key={item.name}>
                      <Button
                        variant="secondary"
                        isActive={location.pathname.includes(
                          item.name.toLowerCase(),
                        )}
                        onClick={() =>
                          navigate(`/settings/${item.name.toLowerCase()}`)
                        }
                        className={cn("flex w-fit min-w-0 justify-start gap-1")}
                      >
                        <item.icon size={18} />
                        <span>{item.name}</span>
                      </Button>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex h-[100vh] flex-1 flex-col overflow-hidden p-2 pl-0">
          <div className="bg-background-2 flex h-full flex-1 flex-col overflow-y-auto rounded-md">
            <Outlet />
          </div>
        </main>
      </SidebarProvider>
    </div>
  );
}

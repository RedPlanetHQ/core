import React from "react";
import { useTauri } from "~/hooks/use-tauri";
import {
  ArrowLeft,
  Code,
  Webhook,
  CreditCard,
  User,
  Tag,
  Building,
  Activity,
  Bot,
  MessageSquare,
  Cpu,
  Brain,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
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
  const { isDesktop } = useTauri();

  const workspaceNav = [
    {
      name: "Overview",
      icon: Building,
      path: "/settings/workspace",
      strict: true,
    },
    { name: "Labels", icon: Tag, path: "/settings/labels" },
    { name: "Activity", icon: Activity, path: "/settings/activity" },
    { name: "Agent", icon: Bot, path: "/settings/workspace/agent" },
    { name: "Models", icon: Cpu, path: "/settings/workspace/models" },
    {
      name: "Channels",
      icon: MessageSquare,
      path: "/settings/workspace/channels",
    },
    ...(isDesktop
      ? [{ name: "Memory", icon: Brain, path: "/settings/workspace/memory" }]
      : []),
  ];

  const data = {
    nav: [
      { name: "Account", icon: User, path: "account" },
      { name: "Billing", icon: CreditCard, path: "billing" },
      { name: "API", icon: Code, path: "api" },
      { name: "Webhooks", icon: Webhook, path: "webhooks" },
    ],
    workspace: workspaceNav,
  };
  const navigate = useNavigate();

  const gotoHome = () => {
    navigate("/home/conversation");
  };

  const isActive = (item: {
    name: string;
    path: string;
    icon?: any;
    strict?: boolean;
  }) => {
    if (item.strict) {
      return location.pathname === item.path;
    } else {
      return location.pathname.includes(item.path);
    }
  };

  return (
    <div className="bg-background h-full w-full overflow-hidden p-0">
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 54)",
            "--header-height": "calc(var(--spacing) * 12)",
            background: "var(--background)",
          } as React.CSSProperties
        }
        className="items-start"
      >
        <Sidebar className="border-none">
          <SidebarHeader className="flex justify-start pb-0">
            <Button
              variant="ghost"
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
                        variant="ghost"
                        isActive={isActive(item)}
                        onClick={() => navigate(`/settings/${item.path}`)}
                        className={cn(
                          "text-foreground flex w-fit min-w-0 justify-start gap-1",
                        )}
                      >
                        <item.icon size={18} />
                        <span>{item.name}</span>
                      </Button>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  <h2 className="mb-1">Workspace</h2>
                  {data.workspace.map((item) => (
                    <SidebarMenuItem key={item.name}>
                      <Button
                        variant="ghost"
                        isActive={isActive(item)}
                        onClick={() => navigate(`${item.path}`)}
                        className={cn(
                          "!text-foreground flex w-fit min-w-0 justify-start gap-1",
                        )}
                      >
                        <item.icon size={16} />
                        <span>{item.name}</span>
                      </Button>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex h-[100vh] flex-1 flex-col overflow-hidden p-2 lg:pl-0">
          <div className="bg-background-2 flex h-full flex-1 flex-col overflow-y-auto rounded-md">
            <div className="flex p-4 pb-0 lg:hidden">
              <SidebarTrigger className="mr-1" />
            </div>
            <Outlet />
          </div>
        </main>
      </SidebarProvider>
    </div>
  );
}

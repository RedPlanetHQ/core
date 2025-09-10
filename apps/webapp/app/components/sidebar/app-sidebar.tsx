import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  Columns3,
  Inbox,
  LayoutGrid,
  MessageSquare,
  Network,
} from "lucide-react";
import { NavMain } from "./nav-main";
import { useUser } from "~/hooks/useUser";
import { NavUser } from "./nav-user";
import Logo from "../logo/logo";
import { ConversationList } from "../conversation";

const data = {
  navMain: [
    {
      title: "Inbox",
      url: "/home/inbox",
      icon: Inbox,
    },
    {
      title: "Chat",
      url: "/home/conversation",
      icon: MessageSquare,
    },
    {
      title: "Memory",
      url: "/home/dashboard",
      icon: Network,
    },
    {
      title: "Spaces",
      url: "/home/space",
      icon: Columns3,
    },
    {
      title: "Integrations",
      url: "/home/integrations",
      icon: LayoutGrid,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const user = useUser();

  return (
    <Sidebar
      variant="inset"
      {...props}
      className="bg-background h-[100vh] py-2"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="mt-1 ml-1 flex w-full items-center justify-start gap-2">
              <Logo size={20} />
              C.O.R.E.
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <div className="mt-4 flex h-full flex-col">
          <h2 className="text-muted-foreground px-4 text-sm"> History </h2>
          <ConversationList />
        </div>
      </SidebarContent>

      <SidebarFooter className="px-2">
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}

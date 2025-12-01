import * as React from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  LayoutGrid,
  MessageSquare,
  Network,
  Plus,
  MessageCircle,
  BookOpen,
  Mail,
  Phone,
  Search,
  Inbox,
} from "lucide-react";
import { NavMain } from "./nav-main";
import { useUser } from "~/hooks/useUser";
import { NavUser } from "./nav-user";
import Logo from "../logo/logo";
import { Button } from "../ui";
import { CommandBar } from "../command-bar/command-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { AddMemoryDialog } from "../command-bar/memory-dialog.client";
import { type Label } from "@prisma/client";
import { DocumentList } from "./document-list";

const data = {
  navMain: [
    {
      title: "Episodes",
      url: "/home/episodes",
      icon: Inbox,
    },
    {
      title: "New chat",
      url: "/home/conversation",
      icon: MessageSquare,
    },
    {
      title: "My mind",
      url: "/home/graph",
      icon: Network,
    },
    {
      title: "Integrations",
      url: "/home/integrations",
      icon: LayoutGrid,
    },
  ],
};

export function AppSidebar({ labels }: { labels: Label[] }) {
  const user = useUser();

  const [commandBar, setCommandBar] = React.useState(false);
  const [memoryAdd, setMemoryAdd] = React.useState(false);

  // Open command bar with Meta+K (Cmd+K on Mac, Ctrl+K on Windows/Linux)
  useHotkeys("meta+k", (e) => {
    e.preventDefault();
    setCommandBar(true);
  });

  return (
    <>
      <Sidebar variant="inset" className="bg-background py-2">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem className="flex justify-center">
              <div className="mt-1 ml-1 flex w-full items-center justify-start gap-2">
                <Logo size={20} />
                C.O.R.E.
              </div>

              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded"
                  onClick={() => setCommandBar(true)}
                >
                  <Search size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded"
                  onClick={() => setMemoryAdd(true)}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={data.navMain} />
          <DocumentList labels={labels} />
        </SidebarContent>

        <SidebarFooter className="flex flex-col gap-2 px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                className="w-full justify-start gap-2 rounded"
                size="lg"
              >
                <MessageCircle size={16} />
                Help
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[200px]">
              <DropdownMenuItem
                className="flex gap-2 rounded"
                onClick={() => window.open("https://docs.getcore.me", "_blank")}
              >
                <BookOpen size={16} />
                Documentation
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex gap-2 rounded"
                onClick={() =>
                  (window.location.href = "mailto:harshith@poozle.dev")
                }
              >
                <Mail size={16} />
                Email Us
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex gap-2 rounded"
                onClick={() =>
                  (window.location.href = "https://cal.com/core-memory/15min")
                }
              >
                <Phone size={16} />
                Book a call
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <NavUser user={user} />
        </SidebarFooter>
      </Sidebar>

      {memoryAdd && (
        <AddMemoryDialog open={memoryAdd} onOpenChange={setMemoryAdd} />
      )}

      <CommandBar open={commandBar} onOpenChange={setCommandBar} />
    </>
  );
}

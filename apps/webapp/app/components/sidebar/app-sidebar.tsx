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
  FileText,
  Search,
  File,
  Contact,
} from "lucide-react";
import { NavMain } from "./nav-main";
import { useUser } from "~/hooks/useUser";
import { NavUser } from "./nav-user";
import Logo from "../logo/logo";
import { Button } from "../ui";
import { CommandBar } from "../command-bar/command-bar";
import { useParams } from "@remix-run/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { AddMemoryDialog } from "../command-bar/memory-dialog.client";
import { RiFolderAddLine } from "@remixicon/react";

const data = {
  navMain: [
    {
      title: "Episodes",
      url: "/home/episodes",
      icon: FileText,
    },
    {
      title: "Persona",
      url: "/home/persona",
      icon: Contact,
    },
    {
      title: "Chat",
      url: "/home/conversation",
      icon: MessageSquare,
    },
    {
      title: "Graph",
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
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
      <Sidebar variant="inset" {...props} className="bg-background py-2">
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
                  onClick={() => setCommandBar(true)}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={data.navMain} />
          {/* <div className="mt-4 flex h-full w-full flex-col">
            <div className="group flex h-8 w-full items-center justify-between gap-1 pr-2">
              <h2 className="text-muted-foreground px-4 text-sm">Favourites</h2>
              <Button variant="link" className="hidden group-hover:flex">
                <RiFolderAddLine size="16 " />
              </Button>
            </div>
          </div> */}
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
                  (window.location.href = "mailto:support@heysol.ai")
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

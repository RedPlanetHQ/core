import * as React from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { tinykeys } from "tinykeys";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  MessageSquare,
  Plus,
  MessageCircle,
  BookOpen,
  Mail,
  Phone,
  Search,
  Brain,
  Library,
  Plug,
  LayoutDashboard,
} from "lucide-react";
import { NavMain } from "./nav-main";
import { useUser } from "~/hooks/useUser";
import { NavUser } from "./nav-user";
import { Button } from "../ui";
import { CommandBar } from "../command-bar/command-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { useNavigate, useParams } from "@remix-run/react";
import { IngestionStatus } from "./ingestion-status";
import { Task } from "../icons/task";

const data = {
  navMain: [
    {
      title: "New chat",
      url: "/home/conversation",
      icon: MessageSquare,
      strict: true,
    },
    {
      title: "Overview",
      url: "/home/overview",
      icon: LayoutDashboard,
    },
    // {
    //   title: "Integrations",
    //   url: "/home/integrations",
    //   icon: LayoutGrid,
    // },
    {
      title: "Memory",
      url: "/home/memory",
      icon: Brain,
    },
    {
      title: "Tasks",
      url: "/home/tasks",
      icon: Task,
    },
    {
      title: "Skills",
      url: "/home/agent/skills",
      icon: Library,
    },
  ],
};

export function AppSidebar({
  conversationSources,
  widgetsEnabled = false,
  agentName = "butler",
  accentColor = "#c87844",
}: {
  conversationSources: { source: string; count: number }[];
  widgetsEnabled?: boolean;
  agentName?: string;
  accentColor?: string;
}) {
  const user = useUser();
  const navigate = useNavigate();
  const params = useParams();

  const [commandBar, setCommandBar] = React.useState(false);

  // Open command bar with Meta+K (Cmd+K on Mac, Ctrl+K on Windows/Linux)
  useHotkeys("meta+k", (e) => {
    e.preventDefault();
    setCommandBar(true);
  });

  // Linear-style go-to sequences via tinykeys
  React.useEffect(() => {
    const whenNotEditing = (fn: () => void) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      fn();
    };

    const unsub = tinykeys(window, {
      "$mod+k": (e) => {
        e.preventDefault();
        setCommandBar(true);
      },
      ...(widgetsEnabled
        ? { "g o": whenNotEditing(() => navigate("/home/overview")) }
        : {}),
      "g t": whenNotEditing(() => navigate("/home/tasks")),
      "g m": whenNotEditing(() => navigate("/home/memory")),
      "g d": whenNotEditing(() => navigate("/home/memory/documents")),
      "g s": whenNotEditing(() => navigate("/home/agent/skills")),
      "g a": whenNotEditing(() => navigate("/home/agent/automations")),
      "g c": whenNotEditing(() => navigate("/home/conversation")),
    });
    return unsub;
  }, [navigate]);

  return (
    <>
      <Sidebar variant="inset" className="bg-background py-2">
        <SidebarHeader className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem className="flex justify-center">
              <div className="ml-1 flex w-full items-center justify-start gap-2">
                <NavUser
                  user={user}
                  agentName={agentName}
                  accentColor={accentColor}
                />
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
                  onClick={() => navigate(`/home/conversation`)}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain
            items={data.navMain.filter(
              (item) => item.url !== "/home/overview" || widgetsEnabled,
            )}
          />
        </SidebarContent>

        <SidebarFooter className="flex flex-col gap-1 px-2">
          <IngestionStatus />
          <Button
            variant="ghost"
            className="justify-end"
            onClick={() => {
              navigate("/settings/billing");
            }}
          >
            <div>{user.availableCredits} credits</div>
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-start gap-2 rounded"
            onClick={() => {
              navigate("/home/agent/connect");
            }}
          >
            <Plug size={18} />
            Connect
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                className="w-full justify-start gap-2 rounded"
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
        </SidebarFooter>
      </Sidebar>

      <CommandBar open={commandBar} onOpenChange={setCommandBar} />
    </>
  );
}

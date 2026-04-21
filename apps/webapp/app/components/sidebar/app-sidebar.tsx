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
  Search,
  Brain,
  Library,
  CalendarDays,
  LayoutDashboard,
  MessageSquare,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { NavMain } from "./nav-main";
import { useUser } from "~/hooks/useUser";
import { NavUser } from "./nav-user";
import { Button } from "../ui";
import { CommandBar } from "../command-bar/command-bar";

import { useNavigate, useParams } from "@remix-run/react";
import { useTauri } from "~/hooks/use-tauri";
import { IngestionStatus } from "./ingestion-status";
import { Task } from "../icons/task";
import { TryIt } from "./try-it";
import { ButlerStatusPill } from "../common/butler-status-pill";

const data = {
  navMain: [
    {
      title: "Daily",
      url: "/home/daily",
      icon: CalendarDays,
    },
    {
      title: "Chat",
      url: "/home/conversation",
      icon: MessageSquare,
    },
    {
      title: "Overview",
      url: "/home/overview",
      icon: LayoutDashboard,
      strict: true,
    },
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
  const { isDesktop } = useTauri();
  const tauriWindowRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (!isDesktop) return;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      tauriWindowRef.current = getCurrentWindow();
    });
  }, [isDesktop]);

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
      "g c": whenNotEditing(() => navigate("/home/conversation")),
      "g d": whenNotEditing(() => navigate("/home/daily")),
      "g t": whenNotEditing(() => navigate("/home/tasks")),
      "g m": whenNotEditing(() => navigate("/home/memory")),
      "g s": whenNotEditing(() => navigate("/home/agent/skills")),
      ...(widgetsEnabled
        ? { "g o": whenNotEditing(() => navigate("/home/overview")) }
        : {}),
    });
    return unsub;
  }, [navigate, widgetsEnabled]);

  return (
    <>
      <Sidebar variant="inset" className="bg-background pb-2 pt-2">
        {isDesktop && (
          <div
            className="flex h-9 shrink-0 items-center justify-between px-3"
            onMouseDown={(e) => {
              if (e.buttons === 1 && tauriWindowRef.current) {
                tauriWindowRef.current.startDragging();
              }
            }}
          >
            {/* Left: space for macOS traffic lights (~70px) */}
            <div className="w-[70px]" />

            {/* Right: back / forward */}
            <div className="flex gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="rounded"
                onClick={() => window.history.back()}
              >
                <ArrowLeft size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded"
                onClick={() => window.history.forward()}
              >
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}
        <SidebarHeader className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem className="flex justify-center">
              <div className="ml-1 flex w-full items-center justify-start gap-2">
                <NavUser
                  user={user}
                  agentName={agentName}
                  accentColor={accentColor}
                />
                <ButlerStatusPill />
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
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="mt-2">
          <NavMain
            items={data.navMain.filter(
              (item) => item.url !== "/home/overview" || widgetsEnabled,
            )}
          />
          <TryIt />
        </SidebarContent>

        <SidebarFooter className="flex flex-col gap-1 px-2 pb-0">
          <IngestionStatus />

          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="w-fit"
              onClick={() => {
                navigate("/settings/billing");
              }}
            >
              <div>{user.availableCredits} credits</div>
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <CommandBar open={commandBar} onOpenChange={setCommandBar} />
    </>
  );
}

import { ChevronDown, Plus } from "lucide-react";
import { useLocation, useNavigate } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { SamAvatar } from "../ui/sam-avatar";

export interface AgentListItem {
  id: string;
  handle: string;
  displayName: string;
  status: "Active" | "Archived";
  kind: "system" | "gateway" | "user";
  gatewayId: string | null;
  appearance: { eye: string; eyeColor: string; accentColor: string };
}

/**
 * Sidebar group listing the workspace's agents. Behaves like the old Gateways
 * group — collapsible, lives in the lower nav area. The header has a `+`
 * button that opens the Create Agent dialog.
 *
 * Order: system (generalist) → user-authored → gateway-backed.
 */
export function AgentsNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/agents");
      if (!res.ok) return;
      const body = (await res.json()) as { agents?: AgentListItem[] };
      setAgents(body.agents ?? []);
    } catch {
      /* leave list as-is on transient failure */
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [refresh]);

  return (
    <SidebarGroup className="mb-2 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between pr-2">
          <CollapsibleTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 py-1 text-sm font-light">
              Agents
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
              />
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-6 w-6"
            title="Create agent"
            onClick={() => navigate("/home/agents/new")}
          >
            <Plus size={14} />
          </Button>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {agents &&
                // Gateway-backed agents are hidden here — a gateway is
                // infrastructure (managed under Settings › Gateways), not
                // a chatteable teammate. Only the generalist + user-
                // authored specialists show up in this list.
                agents
                  .filter((a) => a.kind !== "gateway")
                  .map((a) => {
                    const active =
                      location.pathname === `/home/conversation/${a.handle}`;
                    return (
                      <SidebarMenuItem key={a.id} className="w-full min-w-0">
                        <Button
                          variant="ghost"
                          className="text-foreground flex w-fit min-w-0 justify-start gap-2 !rounded-md"
                          onClick={() =>
                            navigate(`/home/conversation/${a.handle}`)
                          }
                          isActive={active}
                        >

                            <SamAvatar
                              size={20}
                              eye={a.appearance.eye}
                              eyeColor={a.appearance.eyeColor}
                            />
                            <span className="min-w-0 flex-1 truncate text-left">
                              {a.displayName}
                            </span>

                        </Button>
                      </SidebarMenuItem>
                    );
                  })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>

    </SidebarGroup>
  );
}

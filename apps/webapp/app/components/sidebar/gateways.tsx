import { ChevronDown, Plus, Server } from "lucide-react";
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
import { RegisterGatewayDialog } from "../gateway/register-dialog";

interface GatewayListItem {
  id: string;
  name: string;
  status: "CONNECTED" | "DISCONNECTED";
}

/**
 * Sidebar group listing the workspace's gateways. Behaves like the "Try"
 * group — collapsible, lives in the lower nav area. The header has a `+`
 * button that opens the Register Gateway dialog.
 */
export function GatewaysNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const [gateways, setGateways] = useState<GatewayListItem[] | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/gateways");
      if (!res.ok) return;
      const body = (await res.json()) as { gateways?: GatewayListItem[] };
      setGateways(body.gateways ?? []);
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
              Gateways
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
            title="Register gateway"
            onClick={() => setRegisterOpen(true)}
          >
            <Plus size={14} />
          </Button>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {gateways &&
                gateways.map((g) => {
                  const active = location.pathname.startsWith(
                    `/home/gateways/${g.id}`,
                  );
                  return (
                    <SidebarMenuItem key={g.id} className="min-w-0">
                      <Button
                        variant="ghost"
                        className="text-foreground flex min-w-0 justify-start gap-2 !rounded-md"
                        onClick={() => navigate(`/home/gateways/${g.id}/info`)}
                        isActive={active}
                      >
                        <Server size={14} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {g.name}
                        </span>
                      </Button>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>

      <RegisterGatewayDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onRegistered={() => {
          setRegisterOpen(false);
          refresh();
        }}
        trigger={null}
      />
    </SidebarGroup>
  );
}

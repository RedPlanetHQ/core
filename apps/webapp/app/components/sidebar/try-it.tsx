import {
  BookOpen,
  ChevronDown,
  LayoutGrid,
  Mail,
  MessageCircle,
  Phone,
  Plug,
  Puzzle,
} from "lucide-react";
import { useLocation, useNavigate } from "@remix-run/react";
import { useState } from "react";
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
import { Button } from "../ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function TryIt() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const location = useLocation();

  return (
    <SidebarGroup className="py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 py-1 text-sm font-medium">
            Try
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <Button
                  variant="ghost"
                  className="text-foreground w-fit gap-2 !rounded-md"
                  onClick={() => navigate("/home/integrations")}
                  isActive={location.pathname.includes("/home/integrations")}
                >
                  <LayoutGrid size={16} />
                  Integrations
                </Button>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Button
                  variant="ghost"
                  className="text-foreground w-fit gap-2 !rounded-md"
                  onClick={() => navigate("/home/agent/connect")}
                  isActive={location.pathname.includes("/home/agent/connect")}
                >
                  <Plug size={16} />
                  Connect
                </Button>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="text-foreground w-fit gap-2 !rounded-md"
                    >
                      <MessageCircle size={16} />
                      Help
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="right"
                    align="end"
                    className="w-[200px]"
                  >
                    <DropdownMenuItem
                      className="flex gap-2 rounded"
                      onClick={() =>
                        window.open("https://docs.getcore.me", "_blank")
                      }
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
                        (window.location.href =
                          "https://cal.com/core-memory/15min")
                      }
                    >
                      <Phone size={16} />
                      Book a call
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

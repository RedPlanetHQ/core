import { LogOut, Settings } from "lucide-react";
import { AvatarText } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import type { User } from "~/models/user.server";
import { Button } from "../ui";
import { cn } from "~/lib/utils";
import { useLocation, useNavigate } from "@remix-run/react";

export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <SidebarMenu>
      <SidebarMenuItem className="mb-2 flex justify-center">
        <Button
          variant="ghost"
          isActive={location.pathname.includes("settings")}
          className={cn(
            location.pathname.includes("settings") &&
              "!bg-grayAlpha-100 hover:bg-grayAlpha-100!",
          )}
          onClick={() => navigate("/settings")}
        >
          <Settings size={18} />
        </Button>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="link"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mb-2 gap-2 px-3"
            >
              <AvatarText
                text={user.name ?? "User"}
                className="h-6 w-6 rounded"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "top"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex gap-2"
              onClick={() => (window.location.href = "/logout")}
            >
              <LogOut size={16} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

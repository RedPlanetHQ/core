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
import { SidebarMenu, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Button } from "../ui";
import { useNavigate } from "@remix-run/react";
import { type ExtendedUser } from "~/hooks/useUser";

export function NavUser({ user }: { user: ExtendedUser }) {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex justify-between">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="link" className="mb-2 ml-2 gap-2 px-0">
              <AvatarText
                text={user.name ?? "User"}
                className="h-6 w-6 rounded"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "top"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user.displayName}
                  </span>
                  <span className="text-muted-foreground truncate text-sm">
                    {user.email}
                  </span>
                  <span className="text-muted-foreground truncate text-sm">
                    Credits: {user.availableCredits}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex gap-2"
              onClick={() => navigate("/settings/account")}
            >
              <Settings size={16} />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex gap-2"
              onClick={() => navigate("/logout")}
            >
              <LogOut size={16} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          onClick={() => {
            navigate("/settings/billing");
          }}
        >
          <div>{user.availableCredits} credits</div>
        </Button>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

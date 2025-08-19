import { cn } from "~/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import { useLocation, useNavigate } from "@remix-run/react";
import { Button } from "../ui";

export const NavMain = ({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: any;
  }[];
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu className="gap-0.5">
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <Button
                isActive={location.pathname.includes(item.url)}
                className={cn(
                  "bg-grayAlpha-100 text-foreground w-fit gap-1 !rounded-md",
                  location.pathname.includes(item.url) &&
                    "!bg-accent !text-accent-foreground",
                )}
                onClick={() => navigate(item.url)}
                variant="ghost"
              >
                {item.icon && <item.icon size={16} />}
                {item.title}
              </Button>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

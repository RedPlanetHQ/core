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
    params?: Record<string, string>;
    strict?: boolean;
  }[];
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (item: {
    title: string;
    url: string;
    icon?: any;
    strict?: boolean;
  }) => {
    if (item.strict) {
      return location.pathname === item.url;
    } else {
      return location.pathname.includes(item.url);
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu className="gap-0.5">
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <Button
                isActive={isActive(item)}
                className={cn(
                  "bg-grayAlpha-100 text-foreground w-fit gap-1 !rounded-md",
                  isActive(item) && "!bg-accent !text-accent-foreground",
                )}
                onClick={() => {
                  const query = new URLSearchParams(item.params).toString();
                  navigate(`${item.url}?${query}`);
                }}
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

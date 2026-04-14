import React from "react";
import { Plus, X } from "lucide-react";
import { tinykeys } from "tinykeys";
import { cn } from "~/lib/utils";
import { useDesktopTabs } from "./tabs-context";
import { Button } from "../ui";

export function DesktopTabBar() {
  const ctx = useDesktopTabs();

  // Set CSS variable on mount (client-only, Tauri) so calc() in routes works.
  // Can't rely on SidebarProvider style prop — SSR bakes in isDesktop=false.
  React.useEffect(() => {
    document.documentElement.style.setProperty("--tabbar-height", "36px");
    return () => {
      document.documentElement.style.removeProperty("--tabbar-height");
    };
  }, []);

  React.useEffect(() => {
    if (!ctx) return;
    const { openTab, closeTab, switchTab, tabs, activeTabId } = ctx;

    return tinykeys(window, {
      "$mod+t": (e) => {
        e.preventDefault();
        openTab("/home");
      },
      "$mod+w": (e) => {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      },
      "$mod+1": (e) => {
        e.preventDefault();
        if (tabs[0]) switchTab(tabs[0].id);
      },
      "$mod+2": (e) => {
        e.preventDefault();
        if (tabs[1]) switchTab(tabs[1].id);
      },
      "$mod+3": (e) => {
        e.preventDefault();
        if (tabs[2]) switchTab(tabs[2].id);
      },
      "$mod+4": (e) => {
        e.preventDefault();
        if (tabs[3]) switchTab(tabs[3].id);
      },
      "$mod+5": (e) => {
        e.preventDefault();
        if (tabs[4]) switchTab(tabs[4].id);
      },
    });
  }, [ctx]);

  if (!ctx) return null;
  const { tabs, activeTabId, openTab, closeTab, switchTab } = ctx;

  return (
    <div className="bg-background relative h-9 w-full shrink-0">
      {/* Absolute fill gives WebKit a hard pixel width so overflow-x-auto works */}
      <div
        className="absolute inset-0 overflow-x-auto overflow-y-hidden scrollbar-none"
        style={{ paddingRight: "36px" }}
      >
        <div className="flex h-full items-start gap-1.5 pr-2">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "group flex h-7 w-[160px] shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg px-2 text-xs transition-colors",
                tab.id === activeTabId
                  ? "bg-background-3 text-foreground shadow-1"
                  : "bg-background-2 text-muted-foreground hover:text-foreground",
              )}
              onClick={() => switchTab(tab.id)}
            >
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <button
                className={cn(
                  "shrink-0 rounded p-0.5 transition-opacity",
                  tab.id === activeTabId
                    ? "opacity-40 hover:opacity-80"
                    : "opacity-0 group-hover:opacity-40 group-hover:hover:opacity-80",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Close ${tab.title}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Pinned + button, always visible at the right */}
      <div className="!top-3.75 absolute right-1 -translate-y-1/2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => openTab("/home")}
          title="New tab (⌘T)"
          aria-label="New tab"
        >
          <Plus size={12} />
        </Button>
      </div>
    </div>
  );
}

import { useNavigate, useNavigation } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import { useChatPanel } from "~/components/chat-panel/chat-panel-context";

export interface BreadcrumbItem {
  label: string | React.ReactNode;
  href?: string;
}

export interface PageHeaderAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
}

export interface PageHeaderTab {
  label: string;
  value: string;
  isActive: boolean;
  onClick: () => void;
}

export interface PageHeaderProps {
  title: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: PageHeaderAction[];
  actionsNode?: React.ReactNode;
  tabs?: PageHeaderTab[];
  showTrigger?: boolean;
  showChatToggle?: boolean;
}

// Back and Forward navigation component
function NavigationBackForward() {
  const navigate = useNavigate();

  return (
    <div className="mr-1 flex items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        aria-label="Back"
        onClick={() => navigate(-1)}
        className="rounded"
        type="button"
      >
        <ArrowLeft size={16} />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        aria-label="Forward"
        onClick={() => navigate(1)}
        className="rounded"
        type="button"
      >
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}

export function PageHeader({
  title,
  breadcrumbs,
  actions,
  tabs,
  showTrigger = true,
  showChatToggle = true,
  actionsNode,
}: PageHeaderProps) {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const chatPanel = useChatPanel();

  const isLoading =
    navigation.state === "loading" || navigation.state === "submitting";

  return (
    <header className="h-(--header-height) group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) relative flex shrink-0 items-center gap-2 border-b border-gray-300 transition-[width,height] ease-linear">
      {/* Keyframes for the loading bar animation */}
      <style>
        {`
          @keyframes pageheader-loading-bar {
            0% {
              transform: translateX(-100%);
            }
            60% {
              transform: translateX(0%);
            }
            100% {
              transform: translateX(100%);
            }
          }
        `}
      </style>
      <div className="flex w-full items-center justify-between gap-1 px-4 pr-2 lg:gap-2">
        <div className="-ml-1 flex min-w-[0px] shrink items-center gap-1">
          {showTrigger && <SidebarTrigger className="mr-1 shrink-0" />}

          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav className="mt-0.5 flex min-w-[0px] shrink items-center space-x-1">
              {breadcrumbs.map((breadcrumb, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex cursor-default items-center truncate",
                    // On mobile hide all but the last breadcrumb
                    index < breadcrumbs.length - 1 && "hidden md:flex",
                  )}
                >
                  {index > 0 && (
                    <span className="text-muted-foreground mx-1 hidden md:inline">
                      /
                    </span>
                  )}
                  {breadcrumb.href ? (
                    <a
                      className="truncate"
                      onClick={() => navigate(breadcrumb.href as string)}
                    >
                      {breadcrumb.label}
                    </a>
                  ) : (
                    <span className="text-muted-foreground truncate">
                      {breadcrumb.label}
                    </span>
                  )}
                </div>
              ))}
            </nav>
          ) : (
            <h1 className="text-base">{title}</h1>
          )}

          {/* Tabs */}
          {tabs && tabs.length > 0 && (
            <div className="ml-2 flex items-center gap-0.5">
              {tabs.map((tab) => (
                <Button
                  key={tab.value}
                  variant="ghost"
                  className="rounded"
                  isActive={tab.isActive}
                  onClick={tab.onClick}
                  aria-current={tab.isActive ? "page" : undefined}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Actions */}
          {actions && actions.length > 0 && (
            <div className="flex items-center gap-2">
              {actions.map((action, index) => (
                <Button
                  key={index}
                  onClick={action.onClick}
                  variant={action.variant || "secondary"}
                  className="gap-2"
                  disabled={action.disabled}
                >
                  {action.icon}
                  <span className="hidden md:inline">{action.label}</span>
                </Button>
              ))}
            </div>
          )}
          {actionsNode && actionsNode}

          {/* Global chat toggle — visible on every page */}
          {showChatToggle && chatPanel && (
            <Button
              variant="ghost"
              isActive={chatPanel.chatOpen}
              className="gap-1.5 rounded"
              onClick={chatPanel.toggleChat}
              title={chatPanel.chatOpen ? "Close chat" : "Open chat"}
            >
              <MessageSquare size={14} />
              <span className="hidden md:inline">Chat</span>
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-[40px] z-20 h-0.5 w-full overflow-hidden rounded-md"
        >
          <div
            className={`bg-primary/50 h-full w-full transition-opacity duration-200 ${
              isLoading ? "opacity-100" : "opacity-0"
            }`}
            style={{
              transform: isLoading ? "translateX(-100%)" : "translateX(-100%)",
              animation: isLoading
                ? "pageheader-loading-bar 1.2s cubic-bezier(0.4,0,0.2,1) infinite"
                : "none",
            }}
          />
        </div>
      )}
    </header>
  );
}

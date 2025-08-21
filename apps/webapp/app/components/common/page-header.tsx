import { useNavigate, useNavigation } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { SidebarTrigger } from "~/components/ui/sidebar";

export interface BreadcrumbItem {
  label: string | React.ReactNode;
  href?: string;
}

export interface PageHeaderAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "secondary" | "outline" | "ghost";
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
  showBackForward?: boolean;
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
  showBackForward = true,
  actionsNode,
}: PageHeaderProps) {
  const navigation = useNavigation();
  const navigate = useNavigate();

  const isLoading =
    navigation.state === "loading" || navigation.state === "submitting";

  return (
    <header className="relative flex h-(--header-height) shrink-0 items-center gap-2 border-b border-gray-300 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
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
        <div className="-ml-1 flex items-center gap-1">
          {/* Back/Forward navigation before SidebarTrigger */}
          {showBackForward && <NavigationBackForward />}
          <SidebarTrigger className="mr-1" />

          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav className="mt-0.5 flex items-center space-x-1">
              {breadcrumbs.map((breadcrumb, index) => (
                <div key={index} className="flex items-center">
                  {index > 0 && (
                    <span className="text-muted-foreground mx-1">/</span>
                  )}
                  {breadcrumb.href ? (
                    <a onClick={() => navigate(breadcrumb.href as string)}>
                      {breadcrumb.label}
                    </a>
                  ) : (
                    <span className="text-gray-900">{breadcrumb.label}</span>
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
                  size="sm"
                  variant="secondary"
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

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div className="flex items-center gap-2">
            {actions.map((action, index) => (
              <Button
                key={index}
                onClick={action.onClick}
                variant={action.variant || "secondary"}
                className="gap-2"
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {actionsNode && actionsNode}
      </div>

      {isLoading && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[40px] left-0 z-20 h-0.5 w-full overflow-hidden rounded-md"
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

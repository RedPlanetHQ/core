import { useEffect, useState } from "react";
import { useLogs } from "~/hooks/use-logs";
import { LogsFilters } from "~/components/logs/logs-filters";
import { VirtualLogsList } from "~/components/logs/virtual-logs-list";
import { Card, CardContent } from "~/components/ui/card";
import { Database, Inbox, LoaderCircle } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { Outlet, useParams } from "@remix-run/react";
import { cn } from "~/lib/utils";
import { OnboardingModal } from "~/components/onboarding";

export default function LogsAll() {
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [onboarding, setOnboarding] = useState(false);

  const { logId } = useParams();

  const {
    logs,
    hasMore,
    loadMore,
    availableSources,
    isLoading,
    isInitialLoad,
  } = useLogs({
    endpoint: "/api/v1/logs",
    source: selectedSource,
    status: selectedStatus,
    type: selectedType,
  });

  useEffect(() => {
    if (!isLoading && logs && logs.length === 1) {
      // Check if onboarding has been completed before
      const hasCompletedOnboarding =
        typeof window !== "undefined" &&
        localStorage.getItem("onboarding_completed") === "true";

      if (!hasCompletedOnboarding) {
        setOnboarding(true);
      }
    }
  }, [logs.length, isLoading]);

  return (
    <>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          maxSize={50}
          defaultSize={30}
          minSize={30}
          collapsible
          collapsedSize={30}
        >
          <div className="flex h-full flex-col">
            <PageHeader title="Inbox" />

            <div className="flex h-[calc(100vh_-_56px)] w-full flex-col items-center space-y-6 pt-3">
              {isInitialLoad ? (
                <>
                  <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
                </>
              ) : (
                <>
                  {/* Filters */}

                  <LogsFilters
                    availableSources={availableSources}
                    selectedSource={selectedSource}
                    selectedStatus={selectedStatus}
                    selectedType={selectedType}
                    onSourceChange={setSelectedSource}
                    onStatusChange={setSelectedStatus}
                    onTypeChange={setSelectedType}
                  />

                  {/* Logs List */}
                  <div className="flex h-full w-full space-y-4 pb-2">
                    {logs.length === 0 ? (
                      <Card className="bg-background-2 w-full">
                        <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                          <div className="text-center">
                            <Database className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                            <h3 className="mb-2 text-lg font-semibold">
                              No logs found
                            </h3>
                            <p className="text-muted-foreground">
                              {selectedSource || selectedStatus || selectedType
                                ? "Try adjusting your filters to see more results."
                                : "No ingestion logs are available yet."}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <VirtualLogsList
                        logs={logs}
                        hasMore={hasMore}
                        loadMore={loadMore}
                        isLoading={isLoading}
                        height={600}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          collapsible
          collapsedSize={0}
          className={cn(
            "flex flex-col items-start justify-start",
            !logId && "&& items-center justify-center",
          )}
        >
          {!logId && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Inbox size={30} />
              No episode selected
            </div>
          )}
          <Outlet />
        </ResizablePanel>
      </ResizablePanelGroup>

      <OnboardingModal
        isOpen={onboarding}
        onClose={() => {
          setOnboarding(false);
        }}
        onComplete={() => {
          setOnboarding(false);
        }}
      />
    </>
  );
}

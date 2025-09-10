import { useState } from "react";
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

export default function LogsAll() {
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();

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
  });

  return (
    <>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          maxSize={50}
          defaultSize={35}
          minSize={35}
          collapsible
          collapsedSize={35}
        >
          <div className="flex h-full flex-col">
            <PageHeader title="Inbox" />

            <div className="flex h-[calc(100vh_-_56px)] w-full flex-col items-center space-y-6 pt-3 pb-4">
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
                    onSourceChange={setSelectedSource}
                    onStatusChange={setSelectedStatus}
                  />

                  {/* Logs List */}
                  <div className="flex h-full w-full space-y-4">
                    {logs.length === 0 ? (
                      <Card className="bg-background-2 w-full">
                        <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                          <div className="text-center">
                            <Database className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                            <h3 className="mb-2 text-lg font-semibold">
                              No logs found
                            </h3>
                            <p className="text-muted-foreground">
                              {selectedSource || selectedStatus
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
    </>
  );
}

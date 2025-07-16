import { useState } from "react";
import { useLogs } from "~/hooks/use-logs";
import { LogsFilters } from "~/components/logs/logs-filters";
import { VirtualLogsList } from "~/components/logs/virtual-logs-list";
import { AppContainer, PageContainer } from "~/components/layout/app-layout";
import { Card, CardContent } from "~/components/ui/card";
import { Activity } from "lucide-react";

export default function LogsActivity() {
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();

  const {
    logs,
    hasMore,
    loadMore,
    availableSources,
    isLoading,
    isInitialLoad,
  } = useLogs({
    endpoint: "/api/v1/logs/activity",
    source: selectedSource,
    status: selectedStatus,
  });

  if (isInitialLoad) {
    return (
      <AppContainer>
        <PageContainer>
          <div className="flex h-64 items-center justify-center">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
          </div>
        </PageContainer>
      </AppContainer>
    );
  }

  return (
    <div className="space-y-6 p-4 px-5">
      <LogsFilters
        availableSources={availableSources}
        selectedSource={selectedSource}
        selectedStatus={selectedStatus}
        onSourceChange={setSelectedSource}
        onStatusChange={setSelectedStatus}
      />

      {/* Logs List */}
      <div className="space-y-4">
        {logs.length === 0 ? (
          <Card>
            <CardContent className="bg-background-2 flex items-center justify-center py-16">
              <div className="text-center">
                <Activity className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                <h3 className="mb-2 text-lg font-semibold">
                  No activity logs found
                </h3>
                <p className="text-muted-foreground">
                  {selectedSource || selectedStatus
                    ? "Try adjusting your filters to see more results."
                    : "No activity ingestion logs are available yet."}
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
    </div>
  );
}

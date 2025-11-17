import { useEffect, useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useLogs } from "~/hooks/use-logs";
import { LogsFilters } from "~/components/logs/logs-filters";
import { VirtualLogsList } from "~/components/logs/virtual-logs-list";
import { Card, CardContent } from "~/components/ui/card";
import { Database, LoaderCircle } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { OnboardingModal } from "~/components/onboarding";
import { LabelService } from "~/services/label.server";
import { getUser } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const labelService = new LabelService();

  try {
    const labels = await labelService.getWorkspaceLabels(
      user?.Workspace?.id as string,
    );
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

export default function LogsAll() {
  const { labels } = useLoaderData<typeof loader>();
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>();
  const [onboarding, setOnboarding] = useState(false);

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
    label: selectedLabel,
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
      <div className="flex h-full flex-col">
        <PageHeader title="Episodes" />

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
                selectedLabel={selectedLabel}
                labels={labels}
                onSourceChange={setSelectedSource}
                onStatusChange={setSelectedStatus}
                onTypeChange={setSelectedType}
                onLabelChange={setSelectedLabel}
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
                          {selectedSource || selectedStatus || selectedType || selectedLabel
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

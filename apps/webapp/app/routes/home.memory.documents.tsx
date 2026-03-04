import { useEffect, useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useDocuments } from "~/hooks/use-documents";
import { LogsFilters } from "~/components/logs/logs-filters";
import { VirtualLogsList } from "~/components/logs/virtual-logs-list";
import { Card, CardContent } from "~/components/ui/card";
import { FileText, LoaderCircle } from "lucide-react";
import { OnboardingModal } from "~/components/onboarding";
import { LabelService } from "~/services/label.server";
import { getWorkspaceId, requireUser } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const labelService = new LabelService();
  const workspaceId = await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  );

  try {
    const labels = await labelService.getWorkspaceLabels(workspaceId as string);
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

export default function MemoryDocuments() {
  const { labels } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>(
    searchParams.get("label") ?? undefined,
  );
  const [onboarding, setOnboarding] = useState(false);

  // Sync label filter when URL param changes (e.g. navigating from labels page)
  useEffect(() => {
    setSelectedLabel(searchParams.get("label") ?? undefined);
  }, [searchParams.get("label")]);

  const {
    documents,
    hasMore,
    loadMore,
    availableSources,
    isLoading,
    isInitialLoad,
  } = useDocuments({
    endpoint: "/api/v1/documents",
    source: selectedSource,
    status: selectedStatus,
    type: selectedType,
    label: selectedLabel,
  });

  useEffect(() => {
    if (!isLoading && documents && documents.length === 1) {
      const hasCompletedOnboarding =
        typeof window !== "undefined" &&
        localStorage.getItem("onboarding_completed") === "true";

      if (!hasCompletedOnboarding) {
        setOnboarding(true);
      }
    }
  }, [documents?.length, isLoading]);

  return (
    <>
      <div className="flex h-[calc(100vh)] w-full flex-col items-center space-y-6 pt-3 md:h-[calc(100vh_-_56px)]">
        {isInitialLoad ? (
          <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
        ) : (
          <>
            <LogsFilters
              availableSources={availableSources}
              selectedSource={selectedSource}
              selectedStatus={selectedStatus}
              selectedLabel={selectedLabel}
              labels={labels}
              onSourceChange={setSelectedSource}
              onStatusChange={setSelectedStatus}
              onLabelChange={setSelectedLabel}
            />

            <div className="flex h-full w-full space-y-4 pb-2">
              {!documents || documents.length === 0 ? (
                <Card className="bg-background-2 w-full">
                  <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                    <div className="text-center">
                      <FileText className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
                      <h3 className="text-lg font-semibold">
                        No documents found
                      </h3>
                      <p className="text-muted-foreground">
                        {selectedSource ||
                        selectedStatus ||
                        selectedType ||
                        selectedLabel
                          ? "Try adjusting your filters to see more results."
                          : "No documents are available yet."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <VirtualLogsList
                  documents={documents}
                  hasMore={hasMore}
                  loadMore={loadMore}
                  isLoading={isLoading}
                  height={600}
                  labels={labels}
                />
              )}
            </div>
          </>
        )}
      </div>

      <OnboardingModal
        isOpen={onboarding}
        onClose={() => setOnboarding(false)}
        onComplete={() => setOnboarding(false)}
      />
    </>
  );
}

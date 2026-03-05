import { LoaderCircle, RotateCw, AlertCircle } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useIngestionStatus, type FailedIngestionQueueItem } from "~/hooks/use-ingestion-status";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { toast } from "~/hooks/use-toast";

function FailedItem({ item }: { item: FailedIngestionQueueItem }) {
  const retryFetcher = useFetcher<{ success: boolean }>();
  const title = (item.data as any)?.title ?? "Untitled";

  useEffect(() => {
    if (retryFetcher.state === "idle" && retryFetcher.data?.success) {
      toast({ title: "Retry initiated", description: "Ingestion re-queued" });
    }
  }, [retryFetcher.state, retryFetcher.data]);

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="flex-1 truncate text-xs text-muted-foreground" title={title}>
        {title}
      </span>
      {item.documentId && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0"
          disabled={retryFetcher.state !== "idle"}
          onClick={() =>
            retryFetcher.submit(
              {},
              { method: "POST", action: `/api/v1/documents/${item.documentId}/retry` },
            )
          }
        >
          <RotateCw
            size={13}
            className={retryFetcher.state !== "idle" ? "animate-spin" : ""}
          />
        </Button>
      )}
    </div>
  );
}

export function IngestionStatus() {
  const { data } = useIngestionStatus();

  const activeCount =
    data?.queue.filter(
      (item) => item.status === "PROCESSING" || item.status === "PENDING",
    ).length ?? 0;
  const failedItems = data?.failedQueue ?? [];

  if (activeCount === 0 && failedItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {activeCount > 0 && (
        <Card>
          <CardContent className="flex items-center gap-2 p-2">
            <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
            <span>{activeCount} ingesting</span>
          </CardContent>
        </Card>
      )}
      {failedItems.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-1 p-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="text-destructive h-4 w-4 shrink-0" />
              <span className="text-sm">{failedItems.length} failed</span>
            </div>
            {failedItems.map((item) => (
              <FailedItem key={item.id} item={item} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

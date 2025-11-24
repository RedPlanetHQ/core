import { LoaderCircle } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { useIngestionStatus } from "~/hooks/use-ingestion-status";

export function FloatingIngestionStatus() {
  const { data } = useIngestionStatus();

  if (!data || data.count === 0) {
    return null;
  }

  const processingCount = data.queue.filter(
    (item) => item.status === "PROCESSING",
  ).length;
  const pendingCount = data.queue.filter(
    (item) => item.status === "PENDING",
  ).length;

  return (
    <div className="fixed right-4 bottom-4 z-50 hidden max-w-sm md:block">
      <Card className="shadow">
        <CardContent className="flex items-center gap-2 p-2">
          <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
          <span>{processingCount + pendingCount} ingesting</span>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { type LogItem } from "~/hooks/use-logs";

interface LogDetailsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text?: string;
  error?: string;
  log: LogItem;
}

interface EpisodeFact {
  uuid: string;
  fact: string;
  createdAt: string;
  validAt: string;
  attributes: any;
}

interface EpisodeFactsResponse {
  facts: EpisodeFact[];
}

export function LogDetails({
  open,
  onOpenChange,
  text,
  error,
  log,
}: LogDetailsProps) {
  const [facts, setFacts] = useState<any[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const fetcher = useFetcher<EpisodeFactsResponse>();

  // Fetch episode facts when dialog opens and episodeUUID exists
  useEffect(() => {
    if (open && log.episodeUUID && facts.length === 0) {
      setFactsLoading(true);
      fetcher.load(`/api/v1/episodes/${log.episodeUUID}/facts`);
    }
  }, [open, log.episodeUUID, facts.length]);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setFactsLoading(false);
      const response = fetcher.data;
      setFacts(response.facts);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex w-full items-center justify-between">
            <span>Log Details</span>
            <div className="flex gap-0.5">
              {log.episodeUUID && (
                <Badge variant="secondary" className="rounded text-xs">
                  Episode: {log.episodeUUID.slice(0, 8)}...
                </Badge>
              )}
              {log.source && (
                <Badge variant="secondary" className="rounded text-xs">
                  Source: {log.source}
                </Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-auto p-4 pt-0">
          {/* Log Content */}
          <div className="mb-4">
            <div className="rounded-md">
              <p
                className="text-sm break-words whitespace-pre-wrap"
                style={{ lineHeight: "1.5" }}
                dangerouslySetInnerHTML={{ __html: text || "No log details." }}
              />
            </div>
          </div>

          {/* Error Details */}
          {error && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">Error Details</h3>
              <div className="rounded-md border border-red-200 p-3">
                <div className="flex items-start gap-2 text-red-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Episode Facts */}
          {log.episodeUUID && (
            <div className="mb-4">
              <h3 className="text-muted-foreground mb-2 text-sm">Facts</h3>
              <div className="rounded-md">
                {factsLoading ? (
                  <div className="flex items-center justify-center gap-2 p-4 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : facts.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {facts.map((fact) => (
                      <div
                        key={fact.uuid}
                        className="bg-grayAlpha-100 rounded-md p-3"
                      >
                        <p className="mb-1 text-sm">{fact.fact}</p>
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                          <span>
                            Valid: {new Date(fact.validAt).toLocaleString()}
                          </span>
                          {Object.keys(fact.attributes).length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {Object.keys(fact.attributes).length} attributes
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground p-4 text-center text-sm">
                    No facts found for this episode
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

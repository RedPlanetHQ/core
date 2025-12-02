import { useState, useEffect } from "react";
import { type LogItem } from "~/hooks/use-logs";
import { StyledMarkdown } from "~/components/common/styled-markdown";
import { Badge } from "~/components/ui/badge";
import { Loader2 } from "lucide-react";

interface ConversationViewProps {
  log: LogItem;
}

interface InvalidFact {
  uuid: string;
  fact: string;
  createdAt: string;
  validAt: string;
  invalidAt: string | null;
  attributes: any;
}

export function ConversationView({ log }: ConversationViewProps) {
  const [invalidFacts, setInvalidFacts] = useState<InvalidFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);

  useEffect(() => {
    if (!log?.episodeUUID) {
      return;
    }

    setFactsLoading(true);
    fetch(
      `/api/v1/episodes/facts?episodeIds=${encodeURIComponent(log.episodeUUID)}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.results?.[0]) {
          setInvalidFacts(data.results[0].invalidFacts || []);
        }
        setFactsLoading(false);
      })
      .catch(() => {
        setFactsLoading(false);
      });
  }, [log?.episodeUUID]);

  return (
    <div className="flex flex-col items-center p-4 pt-0">
      {/* Content */}
      <div className="mb-4 w-full">
        <div className="text-md rounded-md">
          <StyledMarkdown>{log.ingestText}</StyledMarkdown>
        </div>
      </div>

      {/* Invalidated Facts */}
      {factsLoading ? (
        <div className="text-muted-foreground flex w-full items-center gap-2 p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading facts...
        </div>
      ) : invalidFacts.length > 0 ? (
        <div className="w-full">
          <div className="mb-2 flex items-center justify-between font-medium">
            <span className="text-sm">Invalidated Facts</span>
          </div>
          <div className="flex flex-col gap-2">
            {invalidFacts.map((fact) => (
              <div key={fact.uuid} className="bg-grayAlpha-100 rounded-md p-3">
                <p className="mb-1 text-sm">{fact.fact}</p>
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  {fact.invalidAt && (
                    <span>
                      Invalid: {new Date(fact.invalidAt).toLocaleString()}
                    </span>
                  )}
                  {Object.keys(fact.attributes).length > 0 && (
                    <Badge variant="secondary" className="text-sm">
                      {Object.keys(fact.attributes).length} attributes
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

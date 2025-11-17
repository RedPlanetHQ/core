import { useState, useEffect } from "react";
import { type LogItem } from "~/hooks/use-logs";
import { StyledMarkdown } from "~/components/common/styled-markdown";
import { Loader2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";

interface SessionConversationViewProps {
  log: LogItem;
}

interface SessionEpisode {
  uuid: string;
  content: string;
  originalContent: string;
  createdAt: string;
  labelIds?: string[];
}

interface InvalidFact {
  uuid: string;
  fact: string;
  createdAt: string;
  validAt: string;
  invalidAt: string | null;
  attributes: any;
}

export function SessionConversationView({ log }: SessionConversationViewProps) {
  const [episodes, setEpisodes] = useState<SessionEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invalidFactsByEpisode, setInvalidFactsByEpisode] = useState<
    Record<string, InvalidFact[]>
  >({});
  const [factsLoading, setFactsLoading] = useState(false);

  useEffect(() => {
    if (!log.sessionId) {
      setError("No session ID found");
      setLoading(false);
      return;
    }

    // Fetch all episodes for this session
    fetch(`/api/v1/episodes/session/${log.sessionId}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch session episodes");
        }
        return res.json();
      })
      .then((data) => {
        const fetchedEpisodes = data.episodes || [];
        setEpisodes(fetchedEpisodes);
        setLoading(false);

        // Fetch invalidated facts for all episodes
        if (fetchedEpisodes.length > 0) {
          setFactsLoading(true);
          const episodeIds = fetchedEpisodes
            .map((ep: SessionEpisode) => ep.uuid)
            .join(",");

          fetch(
            `/api/v1/episodes/facts?episodeIds=${encodeURIComponent(episodeIds)}`,
          )
            .then((res) => res.json())
            .then((factsData) => {
              if (factsData.success && factsData.results) {
                const factsMap: Record<string, InvalidFact[]> = {};
                factsData.results.forEach((result: any) => {
                  factsMap[result.episodeId] = result.invalidFacts || [];
                });
                setInvalidFactsByEpisode(factsMap);
              }
              setFactsLoading(false);
            })
            .catch(() => {
              setFactsLoading(false);
            });
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [log.sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-600">
        <p>Error loading session episodes: {error}</p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-center">
        <p>No episodes found for this session</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-4">
        {episodes.map((episode, index) => (
          <div
            key={episode.uuid}
            className="flex flex-col gap-3 rounded-md border-t border-gray-300 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    Episode {index + 1}
                  </span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {new Date(episode.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-grayAlpha-200 border-t pt-3">
              <div className="text-sm">
                <StyledMarkdown>{episode.content}</StyledMarkdown>
              </div>
            </div>

            {/* Invalidated Facts for this episode */}
            {factsLoading ? (
              <div className="border-grayAlpha-200 text-muted-foreground flex items-center gap-2 border-t pt-3 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading facts...
              </div>
            ) : invalidFactsByEpisode[episode.uuid]?.length > 0 ? (
              <div className="border-grayAlpha-200 border-t pt-3">
                <div className="text-muted-foreground mb-2 text-xs font-medium">
                  Invalidated Facts (
                  {invalidFactsByEpisode[episode.uuid].length})
                </div>
                <div className="flex flex-col gap-2">
                  {invalidFactsByEpisode[episode.uuid].map((fact) => (
                    <div
                      key={fact.uuid}
                      className="rounded-md border border-red-200 bg-red-50 p-2"
                    >
                      <p className="mb-1 text-xs">{fact.fact}</p>
                      <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
                        {fact.invalidAt && (
                          <span>
                            Invalid: {new Date(fact.invalidAt).toLocaleString()}
                          </span>
                        )}
                        {Object.keys(fact.attributes).length > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
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
        ))}
      </div>
    </div>
  );
}

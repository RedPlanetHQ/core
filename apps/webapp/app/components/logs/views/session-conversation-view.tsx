import { useState, useEffect } from "react";
import { type LogItem } from "~/hooks/use-logs";
import { StyledMarkdown } from "~/components/common/styled-markdown";
import { Loader2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { cn } from "~/lib/utils";

interface SessionConversationViewProps {
  log: LogItem;
}

interface SessionEpisode {
  uuid: string;
  content: string;
  originalContent: string;
  createdAt: string;
  labelIds?: string[];
  id: string;
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
            .map((ep: SessionEpisode) => ep.id)
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
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4 text-center">
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

  console.log(episodes);

  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-4">
        <Accordion
          type="single"
          collapsible
          className="w-full"
          defaultValue={episodes[0]?.id}
        >
          {episodes.map((episode, index) => (
            <AccordionItem value={episode.id} key={episode.id} className="mb-2">
              <AccordionTrigger className="bg-background-3 hover:shadow-1 flex w-full flex-col justify-between rounded p-4 text-base">
                <div className="flex w-full justify-between">
                  <div className="text-md font-medium">
                    {" "}
                    Episode {index + 1}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {" "}
                    {new Date(episode.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex w-full">
                  <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start gap-2">
                    <div className={cn("truncate text-left")}>
                      {episode.content.replace(/<[^>]+>/g, "")}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-border flex flex-col gap-4 border-b p-4 text-balance">
                <div className="pt-3">
                  <div className="text-base">
                    <StyledMarkdown>{episode.content}</StyledMarkdown>
                  </div>
                </div>

                {/* Invalidated Facts for this episode */}
                {factsLoading ? (
                  <div className="border-grayAlpha-200 text-muted-foreground flex items-center gap-2 border-t pt-3 text-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading facts...
                  </div>
                ) : invalidFactsByEpisode[episode.id]?.length > 0 ? (
                  <div className="">
                    <div className="text-muted-foreground mb-2 font-medium">
                      Invalidated Facts (
                      {invalidFactsByEpisode[episode.id].length})
                    </div>
                    <div className="flex flex-col gap-2">
                      {invalidFactsByEpisode[episode.id].map((fact) => (
                        <div
                          key={fact.uuid}
                          className="rounded-md border border-red-200 bg-red-50 p-2"
                        >
                          <p className="mb-1">{fact.fact}</p>
                          <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
                            {fact.invalidAt && (
                              <span>
                                Invalid:{" "}
                                {new Date(fact.invalidAt).toLocaleString()}
                              </span>
                            )}
                            {Object.keys(fact.attributes).length > 0 && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {Object.keys(fact.attributes).length} attributes
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}

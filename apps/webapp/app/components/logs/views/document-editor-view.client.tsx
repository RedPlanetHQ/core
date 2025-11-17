import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { type Editor } from "@tiptap/react";
import { EditorContent, EditorRoot } from "novel";
import { type LogItem } from "~/hooks/use-logs";

import { Badge } from "~/components/ui/badge";
import { Loader2, Check } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  extensionsForConversation,
  getPlaceholder,
} from "~/components/conversation/editor-extensions";

interface DocumentEditorViewProps {
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

interface SessionEpisode {
  uuid: string;
  content: string;
  originalContent: string;
  createdAt: string;
  labelIds?: string[];
}

export function DocumentEditorView({ log }: DocumentEditorViewProps) {
  const [editor, setEditor] = useState<Editor>();
  const [episodes, setEpisodes] = useState<SessionEpisode[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [invalidFactsByEpisode, setInvalidFactsByEpisode] = useState<
    Record<string, InvalidFact[]>
  >({});
  const [factsLoading, setFactsLoading] = useState(false);
  const fetcher = useFetcher<{ success?: boolean; error?: boolean }>();
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (!log.sessionId) {
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
      .catch(() => {});
  }, [log.sessionId]);

  useEffect(() => {
    if (episodes.length > 0 && editor) {
      editor.setEditable(true);

      // Sort episodes by createdAt in descending order (latest first)
      const sortedEpisodes = [...episodes].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Get the latest episode's content
      const latestContent = sortedEpisodes[0]?.content || "";
      editor.commands.setContent(latestContent);

      // Set up auto-save on content change with debounce
      const handleUpdate = () => {
        setHasChanges(true);

        // Clear existing timeout
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        // Debounced save - waits 3 seconds after user stops typing
        saveTimeoutRef.current = setTimeout(() => {
          handleSave();
        }, 3000);
      };

      editor.on("update", handleUpdate);

      return () => {
        editor.off("update", handleUpdate);
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, editor]);

  const handleSave = useCallback(() => {
    if (!editor || isLoading) return;

    const content = editor?.storage.markdown.getMarkdown();

    // Save using the new document API
    fetcher.submit(
      { content },
      {
        action: `/api/v1/logs/${log.id}/document`,
        method: "POST",
        encType: "application/json",
      },
    );

    setHasChanges(false);
  }, [editor, log.id, fetcher, isLoading]);

  // Update last saved time after successful save
  useEffect(() => {
    if (fetcher.data?.success && fetcher.state === "idle") {
      setHasChanges(false);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <div className="flex w-full flex-col gap-4 p-4 pt-0">
      {/* Editor Section */}
      <div className="relative">
        <div
          className={cn(
            "mix-w-[400px] rounded-md p-4",
            hasChanges && "border-blue-500",
          )}
        >
          <EditorRoot>
            <EditorContent
              editorProps={{
                attributes: {
                  class: "prose prose-sm max-w-none focus:outline-none",
                },
              }}
              editable={false}
              onCreate={({ editor }) => {
                setEditor(editor);
              }}
              extensions={[
                ...extensionsForConversation,
                getPlaceholder("Start writing here..."),
              ]}
              immediatelyRender={false}
            />
          </EditorRoot>
        </div>
      </div>

      {/* Invalidated Facts by Episode */}
      {factsLoading ? (
        <div className="bg-grayAlpha-100 text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading invalidated facts...
        </div>
      ) : (
        <div className="bg-grayAlpha-100 flex flex-col gap-3">
          {episodes.map((episode: any, index: number) => {
            const facts = invalidFactsByEpisode[episode.uuid] || [];
            if (facts.length === 0) return null;

            return (
              <div
                key={episode.uuid}
                className="border-grayAlpha-200 border-t pt-3"
              >
                <div className="mb-2 text-xs font-medium">
                  Episode {index + 1} - Invalidated Facts ({facts.length})
                </div>
                <div className="flex flex-col gap-2">
                  {facts.map((fact) => (
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
            );
          })}
        </div>
      )}
    </div>
  );
}

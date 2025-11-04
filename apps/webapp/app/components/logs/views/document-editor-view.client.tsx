import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { type Editor } from "@tiptap/react";
import { EditorContent, EditorRoot } from "novel";
import { type LogItem } from "~/hooks/use-logs";
import { SpaceDropdown } from "~/components/spaces/space-dropdown";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Save, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";

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

export function DocumentEditorView({ log }: DocumentEditorViewProps) {
  const [editor, setEditor] = useState<Editor>();
  const [hasChanges, setHasChanges] = useState(false);
  const [invalidFactsByEpisode, setInvalidFactsByEpisode] = useState<
    Record<string, InvalidFact[]>
  >({});
  const [factsLoading, setFactsLoading] = useState(false);
  const fetcher = useFetcher();

  const isLoading = fetcher.state === "submitting";
  const episodeDetails = log.episodeDetails || [];

  // Set initial content when editor is ready
  useEffect(() => {
    if (editor && episodeDetails.length > 0) {
      // Combine all episode contents into one document
      const combinedContent = episodeDetails
        .map((episode: any) => episode.content)
        .join("\n\n---\n\n");
      editor.commands.setContent(combinedContent);
    }
  }, [editor, episodeDetails]);

  // Track changes
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      setHasChanges(true);
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor]);

  const handleSave = useCallback(() => {
    if (!editor) return;

    const content = editor.getHTML();

    // Save the updated document
    fetcher.submit(
      {
        content,
        logId: log.id,
      },
      {
        action: "/api/v1/documents/update",
        method: "POST",
        encType: "application/json",
      },
    );

    setHasChanges(false);
  }, [editor, log.id, fetcher]);

  // Show success message after save
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setHasChanges(false);
    }
  }, [fetcher.data, fetcher.state]);

  // Fetch invalidated facts for all episodes
  useEffect(() => {
    if (episodeDetails.length === 0) return;

    setFactsLoading(true);
    const episodeIds = episodeDetails.map((ep: any) => ep.uuid).join(",");

    fetch(`/api/v1/episodes/facts?episodeIds=${encodeURIComponent(episodeIds)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.results) {
          const factsMap: Record<string, InvalidFact[]> = {};
          data.results.forEach((result: any) => {
            factsMap[result.episodeId] = result.invalidFacts || [];
          });
          setInvalidFactsByEpisode(factsMap);
        }
        setFactsLoading(false);
      })
      .catch(() => {
        setFactsLoading(false);
      });
  }, [episodeDetails]);

  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      {/* Space Assignment for all episodes */}
      {episodeDetails.length > 0 && (
        <div className="mb-2 flex items-start gap-2">
          <span className="text-muted-foreground min-w-[120px] text-sm">
            Spaces
          </span>
          <div className="flex flex-wrap gap-2">
            {episodeDetails.map((episode: any, index: number) => (
              <div key={episode.uuid} className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  Episode {index + 1}
                </span>
                <SpaceDropdown
                  episodeIds={[episode.uuid]}
                  selectedSpaceIds={episode.spaceIds || []}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor Section */}
      <div className="relative">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Document Content</span>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isLoading}
            size="sm"
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <div
          className={cn(
            "border-grayAlpha-200 rounded-md border bg-white p-4",
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
              onCreate={({ editor }) => {
                setEditor(editor);
              }}
              extensions={[Document, Paragraph, Text, History, HardBreak]}
              immediatelyRender={false}
            />
          </EditorRoot>
        </div>

        {hasChanges && (
          <p className="text-muted-foreground mt-2 text-xs">
            You have unsaved changes
          </p>
        )}
      </div>

      {/* Episodes Info and Invalidated Facts */}
      <div className="bg-grayAlpha-100 rounded-md p-3">
        <div className="text-muted-foreground mb-3 text-xs">
          This document contains {episodeDetails.length} episode
          {episodeDetails.length !== 1 ? "s" : ""}
        </div>

        {/* Invalidated Facts by Episode */}
        {factsLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading invalidated facts...
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {episodeDetails.map((episode: any, index: number) => {
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
                              Invalid:{" "}
                              {new Date(fact.invalidAt).toLocaleString()}
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
    </div>
  );
}

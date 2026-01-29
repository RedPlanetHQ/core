import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { type Editor } from "@tiptap/react";
import { EditorContent, EditorRoot } from "novel";
import { type DocumentItem } from "~/hooks/use-documents";

import { cn } from "~/lib/utils";
import {
  extensionsForConversation,
  getPlaceholder,
} from "~/components/conversation/editor-extensions";

interface DocumentEditorViewProps {
  document: DocumentItem;
}

export function DocumentEditorView({ document }: DocumentEditorViewProps) {
  const [editor, setEditor] = useState<Editor>();
  const [hasChanges, setHasChanges] = useState(false);
  const fetcher = useFetcher<{ success?: boolean; error?: boolean }>();

  const isLoading = fetcher.state === "submitting";

  const handleSave = useCallback(() => {
    if (!editor || isLoading) return;

    const content = editor?.storage.markdown.getMarkdown();

    // Save using the new document API
    fetcher.submit(
      { content },
      {
        action: `/api/v1/documents/${document.id}`,
        method: "POST",
        encType: "application/json",
      },
    );

    setHasChanges(false);
  }, [editor, document.id, fetcher, isLoading]);

  // Update last saved time after successful save
  useEffect(() => {
    if (fetcher.data?.success && fetcher.state === "idle") {
      setHasChanges(false);
    }
  }, [fetcher.data, fetcher.state]);


  const editable = document.latestIngestionLog && document.latestIngestionLog?.status ? document.latestIngestionLog?.status != "PROCESSING" : true;

  return (
    <div className="flex w-full flex-col gap-4 p-4 pt-0">
      {/* Editor Section */}
      <div className="relative">
        <div
          className={cn(
            "mix-w-[400px] text-md rounded-md",
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
              initialContent={document?.content as any}
              editable={editable}
              onCreate={({ editor }) => {
                setEditor(editor);
              }}
              onUpdate={handleSave}
              extensions={[
                ...extensionsForConversation,
                getPlaceholder("Start writing here..."),
              ]}
              immediatelyRender={false}
            />
          </EditorRoot>
        </div>
      </div>
    </div>
  );
}

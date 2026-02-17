import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { type Editor } from "@tiptap/react";
import { EditorContent, EditorRoot } from "novel";
import { type DocumentItem } from "~/hooks/use-documents";
import { useDebounce } from "~/hooks/use-debounce";

import { cn } from "~/lib/utils";
import {
  extensionsForConversation,
  getPlaceholder,
} from "~/components/conversation/editor-extensions";

interface DocumentEditorViewProps {
  document: DocumentItem;
  editable?: boolean
}

const DEBOUNCE_MS = 500;

export function DocumentEditorView({ document, editable: defaultEditable }: DocumentEditorViewProps) {
  const [editor, setEditor] = useState<Editor>();
  const [content, setContent] = useState<string | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: boolean }>();
  const isInitialMount = useRef(true);

  const debouncedContent = useDebounce(content, DEBOUNCE_MS);
  const isLoading = fetcher.state === "submitting";
  const hasChanges = content !== null && content !== debouncedContent;

  // Save when debounced content changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (debouncedContent === null || isLoading) return;

    fetcher.submit(
      { content: debouncedContent },
      {
        action: `/api/v1/documents/${document.id}`,
        method: "POST",
        encType: "application/json",
      },
    );
  }, [debouncedContent, document.id]);

  const handleUpdate = useCallback(() => {
    if (!editor) return;
    const newContent = editor.storage.markdown.getMarkdown();
    setContent(newContent);
  }, [editor]);

  const editable = defaultEditable && document.latestIngestionLog && document.latestIngestionLog?.status ? document.latestIngestionLog?.status != "PROCESSING" : true;

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
              onUpdate={handleUpdate}
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

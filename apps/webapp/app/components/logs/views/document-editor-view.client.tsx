import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { useEditor, EditorContent } from "@tiptap/react";
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
  const [content, setContent] = useState<string | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: boolean }>();
  const isInitialMount = useRef(true);

  const debouncedContent = useDebounce(content, DEBOUNCE_MS);
  const isLoading = fetcher.state === "submitting";
  const hasChanges = content !== null && content !== debouncedContent;

  const editable = defaultEditable && document.latestIngestionLog && document.latestIngestionLog?.status ? document.latestIngestionLog?.status != "PROCESSING" : true;

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder("Start writing here..."),
    ],
    content: document?.content as any,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none",
      },
    },
    onUpdate({ editor: updatedEditor }) {
      setContent(updatedEditor.storage.markdown.getMarkdown());
    },
  });

  // Sync editable prop to editor
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

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
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

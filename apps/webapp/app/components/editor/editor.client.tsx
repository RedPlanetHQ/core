import { EditorContent, useEditor } from "@tiptap/react";
import {
  extensionsForConversation,
  getPlaceholder,
} from "../conversation/editor-extensions";
import { Button, Input } from "../ui";

import React, { useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { LabelDropdown } from "../logs/label-dropdown";
import { type Label } from "@prisma/client";

interface EditorProps {
  defaultLabelId?: string;
  labels: Label[];
}

export const Editor = ({ defaultLabelId, labels }: EditorProps) => {
  const [title, setTitle] = useState("Untitled");
  const [labelIds, setLabelIds] = React.useState<string[]>(
    defaultLabelId ? [defaultLabelId] : [],
  );

  const fetcher = useFetcher<{ id: string }>();
  const navigate = useNavigate();

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder("Start writing here..."),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-sm focus:outline-none max-w-full min-h-[200px] p-4 py-0",
      },
    },
  });

  const handleAdd = async () => {
    const content = editor?.storage.markdown.getMarkdown();

    if (!content?.trim()) return;

    const payload: Record<string, string | string[]> = {
      episodeBody: content,
      referenceTime: new Date().toISOString(),
      labelIds,
      type: "DOCUMENT",
      sessionId: crypto.randomUUID(),
      source: "core",
    };

    if (title && title !== "Untitled") {
      payload["title"] = title.trim();
    }

    fetcher.submit(payload, {
      method: "POST",
      action: "/api/v1/add",
      encType: "application/json",
    });

    // Clear editor and close dialog
    editor?.commands.clearContent();
    setLabelIds([]);
  };

  React.useEffect(() => {
    if (fetcher.state === "idle") {
      if (fetcher.data !== undefined) {
        navigate(`/home/episodes`);
      }
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="flex h-[calc(100vh)] w-full flex-col items-center space-y-6 pt-3 md:h-[calc(100vh_-_56px)]">
      <div className="flex h-full w-full flex-1 flex-col items-center overflow-y-auto">
        <div className="max-w-4xl min-w-[0px] md:min-w-3xl">
          <div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="no-scrollbar mt-5 resize-none overflow-hidden border-0 bg-transparent px-4 py-0 text-xl font-medium outline-none focus-visible:ring-0"
            />
          </div>

          <div className="my-4 px-4">
            <div className="bg-grayAlpha-100 flex items-center gap-1 rounded-xl px-2 py-2">
              <LabelDropdown value={labelIds} labels={labels} />
            </div>
          </div>

          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="flex w-full justify-end gap-2 border-t border-gray-300 p-2">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleAdd}
            isLoading={fetcher.state !== "idle"}
          >
            Save document
          </Button>
        </div>
      </div>
    </div>
  );
};

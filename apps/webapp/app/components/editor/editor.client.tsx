import { EditorContent, useEditor } from "@tiptap/react";
import {
  extensionsForConversation,
  getPlaceholder,
} from "../conversation/editor-extensions";
import { Button, Input } from "../ui";
import { useState } from "react";

export const Editor = () => {
  const [title, setTitle] = useState("Untitled");

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder("Write your memory here..."),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-sm focus:outline-none max-w-full min-h-[200px] p-4 py-0",
      },
    },
  });

  return (
    <div className="flex h-full w-full flex-col items-center">
      <div className="max-w-4xl min-w-[0px] md:min-w-3xl">
        <div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="no-scrollbar mt-5 resize-none overflow-hidden border-0 bg-transparent px-4 py-0 text-xl font-medium outline-none focus-visible:ring-0"
          />
        </div>

        <EditorContent editor={editor} />
        <div className="flex justify-end gap-2 px-4 pb-4">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => {}}>
              Save document
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

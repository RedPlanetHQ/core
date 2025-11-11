import { Dialog, DialogContent } from "../ui/dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  extensionsForConversation,
  getPlaceholder,
} from "../conversation/editor-extensions";
import { Button } from "../ui/button";
import { SpaceDropdown } from "../spaces/space-dropdown";
import React from "react";
import { useFetcher } from "@remix-run/react";

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSpaceId?: string;
}

export function AddMemoryDialog({
  open,
  onOpenChange,
  defaultSpaceId,
}: AddMemoryDialogProps) {
  const [spaceIds, setSpaceIds] = React.useState<string[]>(
    defaultSpaceId ? [defaultSpaceId] : [],
  );
  const fetcher = useFetcher();
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

  const handleAdd = async () => {
    const content = editor?.getText();
    if (!content?.trim()) return;

    const payload = {
      episodeBody: content,
      referenceTime: new Date().toISOString(),
      spaceIds: spaceIds,
      type: "DOCUMENT",
      sessionId: crypto.randomUUID(),
      source: "core",
    };

    fetcher.submit(payload, {
      method: "POST",
      action: "/api/v1/add",
      encType: "application/json",
    });

    // Clear editor and close dialog
    editor?.commands.clearContent();
    setSpaceIds([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pt-0 sm:max-w-[700px]">
        <div className="overflow-y-auto rounded-md">
          <EditorContent editor={editor} />
        </div>
        <div className="flex justify-between gap-2 px-4 pb-4">
          <div>
            <SpaceDropdown
              episodeIds={[]}
              selectedSpaceIds={spaceIds}
              onSpaceChange={(spaceIds) => {
                setSpaceIds(spaceIds);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleAdd}
              isLoading={fetcher.state !== "idle"}
            >
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

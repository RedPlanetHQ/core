import React, { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { type Editor } from "@tiptap/react";
import { EditorContent, Placeholder, EditorRoot } from "novel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoaderCircle } from "lucide-react";
import { cn } from "~/lib/utils";

interface NewSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function NewSpaceDialog({
  open,
  onOpenChange,
  onSuccess,
}: NewSpaceDialogProps) {
  const [name, setName] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const fetcher = useFetcher();

  const isLoading = fetcher.state === "submitting";

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!name.trim()) {
        return;
      }

      const descriptionText = editor?.getHTML() || "";

      fetcher.submit(
        {
          name: name.trim(),
          description: descriptionText,
        },
        {
          action: "/api/v1/spaces",
          method: "post",
          encType: "application/json",
        },
      );
    },
    [name, editor, fetcher],
  );

  // Handle successful creation
  React.useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setName("");
      editor?.commands.clearContent(true);
      onOpenChange(false);
      onSuccess?.();
    }
  }, [fetcher.data, fetcher.state, editor, onOpenChange, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-auto p-4">
        <DialogHeader>
          <DialogTitle>Create New Space</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 p-1">
          <div className="space-y-2">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter space name"
              required
              disabled={isLoading}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="space-description">Rule</Label>
            <div className="bg-grayAlpha-100 rounded-lg border border-gray-300 p-1">
              <EditorRoot>
                <EditorContent
                  extensions={[
                    Document,
                    Paragraph,
                    Text,
                    HardBreak.configure({
                      keepMarks: true,
                    }),
                    Placeholder.configure({
                      placeholder: "Enter a rule for this space...",
                      includeChildren: true,
                    }),
                    History,
                  ]}
                  onCreate={async ({ editor }) => {
                    setEditor(editor);
                  }}
                  shouldRerenderOnTransaction={false}
                  editorProps={{
                    attributes: {
                      class: `prose prose-sm dark:prose-invert prose-headings:font-title font-default focus:outline-none max-w-full`,
                    },
                  }}
                  immediatelyRender={false}
                  className={cn(
                    "editor-container max-h-[200px] min-h-[80px] w-full overflow-auto rounded p-1 text-sm",
                  )}
                />
              </EditorRoot>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              type="submit"
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Space"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

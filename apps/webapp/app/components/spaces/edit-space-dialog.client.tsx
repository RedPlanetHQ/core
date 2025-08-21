import React, { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { type Editor } from "@tiptap/react";
import { EditorContent, EditorRoot } from "novel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoaderCircle } from "lucide-react";
import { cn } from "~/lib/utils";

interface EditSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  initialName: string;
  initialDescription?: string | null;
  onSuccess?: () => void;
}

export function EditSpaceDialog({
  open,
  onOpenChange,
  spaceId,
  initialName,
  initialDescription,
  onSuccess,
}: EditSpaceDialogProps) {
  const [name, setName] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const fetcher = useFetcher();

  const isLoading = fetcher.state === "submitting";

  // Initialize form with existing data when dialog opens
  useEffect(() => {
    if (open) {
      setName(initialName);
      // Set the initial description in the editor when it's ready
      if (editor && initialDescription) {
        editor.commands.setContent(initialDescription);
      }
    }
  }, [open, initialName, initialDescription, editor]);

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
          action: `/api/v1/spaces/${spaceId}`,
          method: "PUT",
          encType: "application/json",
        },
      );
    },
    [name, editor, fetcher, spaceId],
  );

  // Handle successful update
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      onOpenChange(false);
      onSuccess?.();
    }
  }, [fetcher.data, fetcher.state, onOpenChange, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-auto p-4">
        <DialogHeader>
          <DialogTitle>Edit Space</DialogTitle>
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
            <Label htmlFor="space-description">Description</Label>
            <div className="bg-grayAlpha-100 rounded-lg border border-gray-300 p-1">
              <EditorRoot>
                <EditorContent
                  extensions={[
                    Document,
                    Paragraph,
                    Text,
                    HardBreak.configure({
                      HTMLAttributes: {
                        class: cn("editor-hard-break"),
                      },
                    }),
                    History.configure({ depth: 50 }),
                  ]}
                  editorProps={{
                    attributes: {
                      class: cn(
                        "min-h-[100px] w-full rounded-md border-0 bg-transparent p-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      ),
                    },
                  }}
                  onUpdate={({ editor }) => {
                    setEditor(editor);
                  }}
                  onCreate={({ editor }) => {
                    setEditor(editor);
                    // Set initial content when editor is created
                    if (initialDescription) {
                      editor.commands.setContent(initialDescription);
                    }
                  }}
                ></EditorContent>
              </EditorRoot>
            </div>
          </div>

          <div className="flex justify-end gap-2">
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
              {isLoading && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              )}
              Update Space
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Placeholder } from "novel";
import { extensionsForConversation } from "../conversation/editor-extensions";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, description: string) => void;
  isSubmitting: boolean;
  initialTitle?: string;
  initialDescription?: string;
  mode?: "create" | "edit";
}

function DescriptionEditor({
  initialContent,
  onChange,
}: {
  initialContent?: string;
  onChange: (markdown: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      Placeholder.configure({
        placeholder: "Task description",
      }),
    ],
    content: initialContent || "",
    immediatelyRender: false,

    editorProps: {
      attributes: {
        class:
          "min-h-[80px] py-2 pt-0 focus:outline-none prose prose-sm max-w-none dark:prose-invert",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  return (
    <div className="rounded">
      <EditorContent editor={editor} placeholder="Task description" />
    </div>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  initialTitle = "",
  initialDescription = "",
  mode = "create",
}: NewTaskDialogProps) {
  const [title, setTitle] = React.useState(initialTitle);
  const [description, setDescription] = React.useState(initialDescription);

  React.useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription(initialDescription);
    }
  }, [open, initialTitle, initialDescription]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit(title.trim(), description);
    setTitle("");
    setDescription("");
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setTitle("");
      setDescription("");
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-normal">
            {mode === "edit" ? "Edit task" : "New task"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-1">
            <input
              autoFocus
              className="focus:ring-ring rounded py-2 text-lg focus:outline-none focus:ring-1"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && handleSubmit()
              }
            />
          </div>

          <div className="flex flex-col gap-1">
            {open && (
              <DescriptionEditor
                initialContent={initialDescription}
                onChange={setDescription}
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              className="rounded"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="rounded"
              onClick={handleSubmit}
              disabled={!title.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : mode === "edit" ? (
                "Save"
              ) : (
                "Create task"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

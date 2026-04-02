import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { extensionsForConversation } from "../conversation/editor-extensions";
import {
  TaskStatusDropdown,
  TaskStatusDropdownVariant,
} from "./task-status-dropdown";
import { cn } from "~/lib/utils";
import type { TaskStatus } from "@core/database";

interface DescriptionEditorProps {
  initialContent?: string;
  onChange: (markdown: string) => void;
}

function DescriptionEditor({ initialContent, onChange }: DescriptionEditorProps) {
  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      Placeholder.configure({ placeholder: "Add description..." }),
    ],
    content: initialContent || "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[40px] py-1 focus:outline-none prose prose-sm max-w-none dark:prose-invert text-muted-foreground",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  return <EditorContent editor={editor} />;
}

export interface TaskInlineFormProps {
  defaultStatus?: TaskStatus;
  showStatus?: boolean;
  onSubmit: (title: string, description: string, status: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  initialTitle?: string;
  initialDescription?: string;
}

export function TaskInlineForm({
  defaultStatus = "Todo" as TaskStatus,
  showStatus = true,
  onSubmit,
  onCancel,
  isSubmitting = false,
  mode = "create",
  initialTitle = "",
  initialDescription = "",
}: TaskInlineFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);

  const handleSubmit = () => {
    if (!title.trim() || isSubmitting) return;
    onSubmit(title.trim(), description, status);
  };

  return (
    <div className="rounded-lg border p-3 flex flex-col gap-2 bg-background">
      <div className="flex items-center gap-2">
        {showStatus && (
          <div className="shrink-0">
            <TaskStatusDropdown
              value={status}
              onChange={(s) => setStatus(s as TaskStatus)}
              variant={TaskStatusDropdownVariant.NO_BACKGROUND}
            />
          </div>
        )}
        <input
          autoFocus
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
          placeholder="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleSubmit();
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className={cn("text-sm", showStatus && "pl-7")}>
        <DescriptionEditor
          initialContent={initialDescription}
          onChange={setDescription}
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded text-xs"
          onClick={handleSubmit}
          disabled={!title.trim() || isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : mode === "edit" ? (
            "Save"
          ) : (
            "Create"
          )}
        </Button>
      </div>
    </div>
  );
}

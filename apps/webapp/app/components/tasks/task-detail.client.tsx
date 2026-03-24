import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Trash2, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  TaskConversationsSelect,
  formatRunLabel,
} from "~/components/tasks/task-conversations-select";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import type { getTasks } from "~/services/task.server";
import type { getConversationAndHistory } from "~/services/conversation.server";
import { extensionsForConversation } from "../conversation/editor-extensions";

type ConversationItem = NonNullable<
  Awaited<ReturnType<typeof getConversationAndHistory>>
>;

interface TaskDetailProps {
  task: Awaited<ReturnType<typeof getTasks>>[number];
  conversations: ConversationItem[];
  integrationAccountMap?: Record<string, string>;
  onSave: (title: string, description: string) => void;
  onDelete: () => void;
  onClose: () => void;
  isSubmitting: boolean;
  butlerName?: string;
}

function DescriptionEditor({
  initialContent,
  onChange,
}: {
  initialContent: string;
  onChange: (markdown: string) => void;
}) {
  const editor = useEditor({
    extensions: [...extensionsForConversation],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[120px] focus:outline-none prose prose-sm max-w-none dark:prose-invert",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  return <EditorContent editor={editor} />;
}

export function TaskDetail({
  task,
  conversations,
  integrationAccountMap = {},
  onSave,
  onDelete,
  onClose,
  isSubmitting,
  butlerName = "Core",
}: TaskDetailProps) {
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [activeTab, setActiveTab] = React.useState("info");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [selectedConversationId, setSelectedConversationId] = React.useState(
    () => conversations[conversations.length - 1]?.id ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({
    title: task.title,
    description: task.description ?? "",
  });

  // Reset state when task changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    lastSavedRef.current = {
      title: task.title,
      description: task.description ?? "",
    };
    setSelectedConversationId(conversations[conversations.length - 1]?.id ?? "");
  }, [task.id]);

  const triggerSave = (nextTitle: string, nextDesc: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const saved = lastSavedRef.current;
      if (
        nextTitle.trim() &&
        (nextTitle !== saved.title || nextDesc !== saved.description)
      ) {
        lastSavedRef.current = { title: nextTitle, description: nextDesc };
        onSave(nextTitle, nextDesc);
      }
    }, 800);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    triggerSave(e.target.value, description);
  };

  const handleDescriptionChange = (markdown: string) => {
    setDescription(markdown);
    triggerSave(title, markdown);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <TabsList className="rounded">
          <TabsTrigger value="info" className="rounded">
            Info
          </TabsTrigger>
          <TabsTrigger value="conversation" className="rounded">
            Conversations
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-1">
          {activeTab === "conversation" && conversations.length > 1 && (
            <Select
              value={selectedConversationId}
              onValueChange={setSelectedConversationId}
            >
              <SelectTrigger className="h-7 w-auto rounded border-none bg-transparent text-xs shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {[...conversations].reverse().map((conv, i) => (
                  <SelectItem key={conv.id} value={conv.id} className="text-xs">
                    {formatRunLabel(conv, conversations.length - 1 - i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <TabsContent
        value="info"
        className="mt-0 flex flex-1 flex-col overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-1 flex-col gap-4">
          <input
            className="w-full bg-transparent text-xl font-medium focus:outline-none"
            value={title}
            onChange={handleTitleChange}
            placeholder="Task title"
          />

          <div className="flex flex-col gap-1">
            <DescriptionEditor
              initialContent={task.description ?? ""}
              onChange={handleDescriptionChange}
            />
          </div>

          <div className="mt-auto flex w-full justify-end pt-4">
            <Button
              variant="secondary"
              className="rounded"
              size="lg"
              onClick={() => setDeleteOpen(true)}
              disabled={isSubmitting}
            >
              <Trash2 size={14} className="mr-1" />
              Delete task
            </Button>
          </div>
        </div>
      </TabsContent>

      <TabsContent
        value="conversation"
        className="mt-0 flex flex-1 flex-col overflow-hidden"
      >
        <TaskConversationsSelect
          conversations={conversations}
          selectedId={selectedConversationId}
          integrationAccountMap={integrationAccountMap}
          butlerName={butlerName}
        />
      </TabsContent>
      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </Tabs>
  );
}

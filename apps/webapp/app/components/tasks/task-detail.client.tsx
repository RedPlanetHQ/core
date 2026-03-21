import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Loader2, Trash2, MessageSquarePlus, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Button } from "~/components/ui/button";
import { ConversationView, ConversationItem } from "~/components/conversation";
import { ScrollAreaWithAutoScroll } from "~/components/use-auto-scroll";
import { DeleteTaskDialog } from "~/components/tasks/delete-task-dialog";
import { UserTypeEnum } from "@core/types";
import type { UIMessage } from "ai";
import type { getTasks } from "~/services/task.server";
import type { getConversationAndHistory } from "~/services/conversation.server";
import { extensionsForConversation } from "../conversation/editor-extensions";

interface TaskDetailProps {
  task: Awaited<ReturnType<typeof getTasks>>[number];
  conversation: Awaited<ReturnType<typeof getConversationAndHistory>> | null;
  integrationAccountMap?: Record<string, string>;
  onSave: (title: string, description: string) => void;
  onDelete: () => void;
  onCreateConversation: () => void;
  onClose: () => void;
  isSubmitting: boolean;
  newConversation?: boolean;
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
  conversation,
  integrationAccountMap = {},
  onSave,
  onDelete,
  onCreateConversation,
  onClose,
  isSubmitting,
  newConversation = false,
}: TaskDetailProps) {
  const isInProgress = task.status === "InProgress";

  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [activeTab, setActiveTab] = React.useState("info");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
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
  }, [task.id]);

  // Auto-switch to conversation tab when a new conversation is created
  useEffect(() => {
    if (newConversation && conversation) {
      setActiveTab("conversation");
    }
  }, [newConversation, conversation]);

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
      <div className="flex justify-between px-3 pt-2">
        <TabsList className="rounded">
          <TabsTrigger value="info" className="rounded">
            Info
          </TabsTrigger>
          <TabsTrigger value="conversation" className="rounded">
            Conversation
          </TabsTrigger>
        </TabsList>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded"
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>

      <TabsContent
        value="info"
        className="mt-0 flex flex-1 flex-col overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-1 flex-col gap-4">
          <input
            className="w-full bg-transparent text-xl font-medium focus:outline-none disabled:opacity-60"
            value={title}
            onChange={handleTitleChange}
            placeholder="Task title"
            disabled={isInProgress}
          />

          <div
            className={`flex flex-col gap-1 ${isInProgress ? "pointer-events-none opacity-60" : ""}`}
          >
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
              disabled={isSubmitting || isInProgress}
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
        {conversation ? (
          isInProgress ? (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="text-muted-foreground flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-xs">
                <Loader2 size={12} className="animate-spin" />
                Agent is working…
              </div>
              <ScrollAreaWithAutoScroll>
                {conversation.ConversationHistory.map((h) => (
                  <ConversationItem
                    key={h.id}
                    message={
                      {
                        id: h.id,
                        role:
                          h.userType === UserTypeEnum.Agent
                            ? "assistant"
                            : "user",
                        parts: h.parts
                          ? (h.parts as UIMessage["parts"])
                          : [{ text: h.message, type: "text" }],
                      } as UIMessage
                    }
                    addToolApprovalResponse={async () => {}}
                    integrationAccountMap={integrationAccountMap}
                  />
                ))}
              </ScrollAreaWithAutoScroll>
            </div>
          ) : (
            <ConversationView
              key={`${task.id}-${conversation.ConversationHistory.length}`}
              conversationId={conversation.id}
              history={conversation.ConversationHistory}
              integrationAccountMap={integrationAccountMap}
              className="py-0"
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <MessageSquarePlus className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground">
              {task.status === "Backlog" || task.status === "Todo"
                ? "Task is queued — conversation will appear once it starts."
                : "No conversation yet."}
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="rounded"
              onClick={onCreateConversation}
              disabled={isSubmitting}
            >
              <MessageSquarePlus size={14} className="mr-1" />
              Start conversation
            </Button>
          </div>
        )}
      </TabsContent>
      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </Tabs>
  );
}

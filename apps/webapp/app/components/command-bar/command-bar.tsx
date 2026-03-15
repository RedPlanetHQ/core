import { useState, useEffect } from "react";
import { Plus, Loader2, File, MessageSquare, Tag } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  Command,
} from "../ui/command";

import { useNavigate } from "@remix-run/react";
import { useDebounce } from "~/hooks/use-debounce";
import { NewTaskDialog } from "~/components/tasks/new-task-dialog.client";
import { Task } from "../icons/task";

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentResult {
  id: string;
  sessionId: string | null;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface ConversationResult {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface LabelResult {
  id: string;
  name: string;
  color: string;
}

interface TaskResult {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [documentResults, setDocumentResults] = useState<DocumentResult[]>([]);
  const [conversationResults, setConversationResults] = useState<
    ConversationResult[]
  >([]);
  const [labelResults, setLabelResults] = useState<LabelResult[]>([]);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const navigate = useNavigate();

  // Search documents and conversations when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setDocumentResults([]);
      setConversationResults([]);
      setLabelResults([]);
      setTaskResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const [docsRes, convsRes, labelsRes, tasksRes] = await Promise.all([
          fetch(
            `/api/v1/documents/search?${new URLSearchParams({ q: debouncedQuery, mode: "full", limit: "10" })}`,
          ),
          fetch(
            `/api/v1/conversations?${new URLSearchParams({ search: debouncedQuery, limit: "10" })}`,
          ),
          fetch(
            `/api/v1/labels?${new URLSearchParams({ search: debouncedQuery })}`,
          ),
          fetch(
            `/api/v1/tasks?${new URLSearchParams({ search: debouncedQuery })}`,
          ),
        ]);
        if (docsRes.ok) {
          const data = await docsRes.json();
          setDocumentResults(data.documents || []);
        }
        if (convsRes.ok) {
          const data = await convsRes.json();
          setConversationResults(data.conversations || []);
        }
        if (labelsRes.ok) {
          const data = await labelsRes.json();
          setLabelResults(data || []);
        }
        if (tasksRes.ok) {
          const data = await tasksRes.json();
          setTaskResults(data || []);
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    };

    search();
  }, [debouncedQuery]);

  const handleAddDocument = () => {
    navigate(`/home/memory/document`);
    onOpenChange(false);
  };

  const handleNewChat = () => {
    navigate(`/home/conversation`);
    onOpenChange(false);
  };

  const handleAddTask = () => {
    onOpenChange(false);
    setNewTaskOpen(true);
  };

  const handleTaskCreate = async (title: string, description: string) => {
    setIsCreatingTask(true);
    try {
      const formData = new FormData();
      formData.set("intent", "create");
      formData.set("title", title);
      if (description) formData.set("description", description);

      const res = await fetch("/home/tasks", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setNewTaskOpen(false);
        if (data?.task?.id) {
          navigate(`/home/tasks?taskId=${data.task.id}`);
        } else {
          navigate(`/home/tasks`);
        }
      }
    } catch (error) {
      console.error("Task creation failed:", error);
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleDocumentClick = (documentId: string) => {
    navigate(`/home/memory/documents/${documentId}`);
    onOpenChange(false);
  };

  const handleConversationClick = (conversationId: string) => {
    navigate(`/home/conversation/${conversationId}`);
    onOpenChange(false);
  };

  const handleLabelClick = (labelId: string) => {
    navigate(`/home/memory/documents?label=${labelId}`);
    onOpenChange(false);
  };

  const handleTaskClick = (taskId: string) => {
    navigate(`/home/tasks?taskId=${taskId}`);
    onOpenChange(false);
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search conversations, tasks and documents..."
            className="py-1"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="h-72">
            <CommandEmpty className="text-muted-foreground p-4 text-center text-sm">
              {debouncedQuery.length >= 2 &&
              !isSearching &&
              documentResults.length === 0
                ? "No documents found."
                : ""}
            </CommandEmpty>

            <CommandGroup className="p-2">
              <CommandItem
                onSelect={handleNewChat}
                className="flex items-center gap-2 py-1"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                <span>New Chat</span>
              </CommandItem>
              <CommandItem
                onSelect={handleAddTask}
                className="flex items-center gap-2 py-1"
              >
                <Task className="mr-2 h-4 w-4" />
                <span>Add Task</span>
              </CommandItem>
              <CommandItem
                onSelect={handleAddDocument}
                className="flex items-center gap-2 py-1"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span>Add Document</span>
              </CommandItem>
            </CommandGroup>

            {/* Labels */}
            {labelResults.length > 0 && (
              <CommandGroup heading="Labels" className="max-w-[700px] p-2">
                {labelResults.map((label) => (
                  <CommandItem
                    key={label.id}
                    value={label.id}
                    onSelect={() => handleLabelClick(label.id)}
                    className="flex items-center gap-2 py-2"
                  >
                    <Tag
                      className="h-4 w-4 flex-shrink-0"
                      style={{ color: label.color }}
                    />
                    <span className="text-foreground truncate text-sm">
                      {label.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Tasks */}
            {taskResults.length > 0 && (
              <CommandGroup heading="Tasks" className="max-w-[700px] p-2">
                {taskResults.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={task.id}
                    onSelect={() => handleTaskClick(task.id)}
                    className="flex items-center gap-2 py-2"
                  >
                    <Task className="h-4 w-4 flex-shrink-0" />
                    <span className="text-foreground truncate text-sm">
                      {task.title}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Conversations */}
            {conversationResults.length > 0 && (
              <CommandGroup
                heading="Conversations"
                className="max-w-[700px] p-2"
              >
                {conversationResults.map((conv) => (
                  <CommandItem
                    key={conv.id}
                    value={conv.id}
                    onSelect={() => handleConversationClick(conv.id)}
                    className="flex items-center gap-2 py-2"
                  >
                    <MessageSquare className="h-4 w-4 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm">
                        {conv.title || "Untitled Conversation"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(conv.updatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Documents */}
            <CommandGroup heading="Documents" className="max-w-[700px] p-2">
              {isSearching && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                </div>
              )}

              {!isSearching &&
                documentResults.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    value={doc.id}
                    onSelect={() => handleDocumentClick(doc.id)}
                    className="flex items-center gap-2 py-2"
                    disabled={false}
                  >
                    <File className="h-4 w-4 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm">
                        {doc.title}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </CommandItem>
                ))}

              {!isSearching &&
                documentResults.length === 0 &&
                debouncedQuery.length < 2 && (
                  <div className="text-muted-foreground py-4 text-center text-sm">
                    Start typing to search
                  </div>
                )}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      {newTaskOpen && (
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          onSubmit={handleTaskCreate}
          isSubmitting={isCreatingTask}
        />
      )}
    </>
  );
}

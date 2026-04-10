import { useState, useEffect } from "react";
import {
  Plus,
  Loader2,
  File,
  MessageSquare,
  Tag,
  Brain,
  Library,
  MessagesSquare,
} from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  Command,
  CommandSeparator,
} from "../ui/command";

import { useNavigate } from "@remix-run/react";
import { useDebounce } from "~/hooks/use-debounce";
import { Task } from "../icons/task";

const NAV_ITEMS = [
  {
    label: "Go to Chats",
    url: "/home/conversation",
    icon: MessagesSquare,
    shortcut: "G C",
  },
  {
    label: "Go to Tasks",
    url: "/home/tasks",
    icon: Task,
    shortcut: "G T",
  },
  {
    label: "Go to Memory",
    url: "/home/memory",
    icon: Brain,
    shortcut: "G M",
  },
  {
    label: "Go to Documents",
    url: "/home/memory/documents",
    icon: File,
    shortcut: "G D",
  },
  {
    label: "Go to Skills",
    url: "/home/agent/skills",
    icon: Library,
    shortcut: "G S",
  },
];

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
    navigate("/home/conversation?msg=Create+a+new+task");
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
    navigate(`/home/tasks/${taskId}`);
    onOpenChange(false);
  };

  return (
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

            <CommandGroup heading="Navigate" className="p-2">
              {NAV_ITEMS.filter(
                (item) =>
                  !searchQuery.trim() ||
                  item.label.toLowerCase().includes(searchQuery.toLowerCase()),
              ).map((item) => (
                <CommandItem
                  key={item.url}
                  onSelect={() => {
                    navigate(item.url);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center gap-2 py-1"
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-muted-foreground ml-auto flex gap-1 text-xs">
                    {item.shortcut.split(" ").map((key, i) => (
                      <div
                        key={i}
                        className="bg-grayAlpha-100 rounded px-1.5 py-0.5 font-mono"
                      >
                        {key}
                      </div>
                    ))}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Actions" className="p-2">
              {[
                {
                  label: "New Chat",
                  icon: MessageSquare,
                  onSelect: handleNewChat,
                },
                { label: "Add Task", icon: Task, onSelect: handleAddTask },
                {
                  label: "Add Document",
                  icon: Plus,
                  onSelect: handleAddDocument,
                },
              ]
                .filter(
                  (action) =>
                    !searchQuery.trim() ||
                    action.label
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase()),
                )
                .map((action) => (
                  <CommandItem
                    key={action.label}
                    onSelect={action.onSelect}
                    className="flex items-center gap-2 py-1"
                  >
                    <action.icon className="mr-2 h-4 w-4" />
                    <span>{action.label}</span>
                  </CommandItem>
                ))}
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
  );
}

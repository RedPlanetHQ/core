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
  CalendarDays,
  Terminal,
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
    label: "Go to Daily",
    url: "/home/daily",
    icon: CalendarDays,
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

interface CodingTarget {
  gatewayId: string;
  gatewayName: string;
  agent: string;
  /// First coding-scoped folder on this gateway — the session will run here.
  /// If null, the gateway has no coding-scoped folder configured and the
  /// item is hidden.
  folderPath: string;
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
  const [codingTargets, setCodingTargets] = useState<CodingTarget[]>([]);
  const [spawningKey, setSpawningKey] = useState<string | null>(null);
  const navigate = useNavigate();

  // Load connected gateways + their agents whenever the bar opens so the
  // "New session" items reflect what's actually reachable right now.
  useEffect(() => {
    if (!open) {
      setCodingTargets([]);
      setSpawningKey(null);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const gwRes = await fetch("/api/v1/gateways");
        if (!gwRes.ok) return;
        const gwBody = (await gwRes.json()) as {
          gateways: Array<{
            id: string;
            name: string;
            status: "CONNECTED" | "DISCONNECTED";
          }>;
        };
        const connected = (gwBody.gateways ?? []).filter(
          (g) => g.status === "CONNECTED",
        );
        if (connected.length === 0) {
          if (!cancelled) setCodingTargets([]);
          return;
        }

        const infos = await Promise.all(
          connected.map(async (g) => {
            try {
              const res = await fetch(`/api/v1/gateways/${g.id}/info`);
              if (!res.ok) return null;
              const data = (await res.json()) as {
                folders?: Array<{
                  path: string;
                  scopes: Array<"files" | "coding" | "exec">;
                }>;
                agents?: string[];
              };
              const codingFolder = (data.folders ?? []).find((f) =>
                f.scopes.includes("coding"),
              );
              if (!codingFolder) return null;
              const agents = data.agents ?? [];
              if (agents.length === 0) return null;
              return agents.map((agent) => ({
                gatewayId: g.id,
                gatewayName: g.name,
                agent,
                folderPath: codingFolder.path,
              }));
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) return;
        const flat: CodingTarget[] = infos
          .filter((x): x is CodingTarget[] => x !== null)
          .flat();
        setCodingTargets(flat);
      } catch {
        if (!cancelled) setCodingTargets([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleNewCodingSession = async (target: CodingTarget) => {
    const key = `${target.gatewayId}:${target.agent}`;
    if (spawningKey) return;
    setSpawningKey(key);
    try {
      const res = await fetch("/api/v1/coding-sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayId: target.gatewayId,
          agent: target.agent,
          dir: target.folderPath,
        }),
      });
      if (!res.ok) {
        // Bar stays open so the user can retry on a different target.
        console.error("Failed to spawn coding session", await res.text());
        return;
      }
      const body = (await res.json()) as {
        task: { id: string };
        session: { id: string };
      };
      navigate(
        `/home/tasks/${body.task.id}/coding/${body.session.id}`,
      );
      onOpenChange(false);
    } finally {
      setSpawningKey(null);
    }
  };

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

          {/* Coding sessions (one item per gateway × agent that's connected
              and has a coding-scoped folder). */}
          {codingTargets.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="New coding session" className="p-2">
                {codingTargets
                  .filter(
                    (target) =>
                      !searchQuery.trim() ||
                      `new session ${target.agent} ${target.gatewayName}`
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                  )
                  .map((target) => {
                    const key = `${target.gatewayId}:${target.agent}`;
                    const isSpawning = spawningKey === key;
                    return (
                      <CommandItem
                        key={key}
                        value={key}
                        onSelect={() => handleNewCodingSession(target)}
                        disabled={Boolean(spawningKey) && !isSpawning}
                        className="flex items-center gap-2 py-1"
                      >
                        {isSpawning ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Terminal className="mr-2 h-4 w-4" />
                        )}
                        <span className="flex-1">
                          New session — {target.agent} —{" "}
                          <span className="text-muted-foreground">
                            {target.gatewayName}
                          </span>
                        </span>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </>
          )}

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
            <CommandGroup heading="Conversations" className="max-w-[700px] p-2">
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

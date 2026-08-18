import { useState, useEffect } from "react";
import {
  Plus,
  Loader2,
  File,
  MessageSquare,
  Tag,
  Brain,
  Library,
  CalendarDays,
  Terminal,
  User as UserIcon,
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
import { NewSessionDialog } from "~/components/coding/new-session-dialog";

const NAV_ITEMS = [
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
}

interface AgentTarget {
  handle: string;
  displayName: string;
  /** "system" for the workspace generalist, "user" for user-authored,
   *  "gateway" for gateway-backed. Used to pick the default agent for
   *  actions like "Add Task" that want to hit the generalist. */
  kind: "system" | "user" | "gateway";
}

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [documentResults, setDocumentResults] = useState<DocumentResult[]>([]);
  const [labelResults, setLabelResults] = useState<LabelResult[]>([]);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [codingTargets, setCodingTargets] = useState<CodingTarget[]>([]);
  // Active workspace agents. Fetched fresh each time the bar opens so
  // freshly-added agents (Create Agent) show up without a page reload.
  const [agentTargets, setAgentTargets] = useState<AgentTarget[]>([]);
  // When set, NewSessionDialog opens prefilled with this gateway+agent so
  // the user only has to pick (or type) a folder.
  const [pendingTarget, setPendingTarget] = useState<CodingTarget | null>(
    null,
  );
  const navigate = useNavigate();

  // Load workspace agents whenever the bar opens so the "Go to {agent}"
  // list reflects what's currently active.
  useEffect(() => {
    if (!open) {
      setAgentTargets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/agents");
        if (!res.ok) return;
        const body = (await res.json()) as {
          agents: Array<{
            handle: string;
            displayName: string;
            status: string;
            kind: "system" | "user" | "gateway";
          }>;
        };
        if (cancelled) return;
        const active = (body.agents ?? [])
          .filter((a) => a.status === "Active")
          .map((a) => ({
            handle: a.handle,
            displayName: a.displayName,
            kind: a.kind,
          }));
        setAgentTargets(active);
      } catch {
        if (!cancelled) setAgentTargets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load connected gateways + their agents whenever the bar opens so the
  // "New session" items reflect what's actually reachable right now.
  useEffect(() => {
    if (!open) {
      setCodingTargets([]);
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
                agents?: string[];
              };
              const agents = data.agents ?? [];
              if (agents.length === 0) return null;
              return agents.map((agent) => ({
                gatewayId: g.id,
                gatewayName: g.name,
                agent,
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

  const handleNewCodingSession = (target: CodingTarget) => {
    // Close the command-bar and hand off to NewSessionDialog so the user
    // can pick or enter a folder. The dialog calls back into onCreated
    // below, which routes to the new session.
    setPendingTarget(target);
    onOpenChange(false);
  };

  const handleSessionCreated = (args: {
    id: string;
    taskId: string;
  }) => {
    navigate(`/home/tasks/${args.taskId}/coding/${args.id}`);
  };

  // Search documents, labels, and tasks when debounced query changes.
  // Conversation search removed — chats live per-agent now, not as a
  // searchable global list.
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setDocumentResults([]);
      setLabelResults([]);
      setTaskResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const [docsRes, labelsRes, tasksRes] = await Promise.all([
          fetch(
            `/api/v1/documents/search?${new URLSearchParams({ q: debouncedQuery, mode: "full", limit: "10" })}`,
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

  const handleAddTask = () => {
    // Route into the system generalist's conversation with the composer
    // pre-filled. The generalist owns task creation; if for some reason
    // we haven't resolved one yet (initial mount, request in flight),
    // fall through to the bare route which redirects to the generalist.
    const generalist = agentTargets.find((a) => a.kind === "system");
    const dest = generalist
      ? `/home/conversation/${generalist.handle}?msg=Create+a+task`
      : "/home/conversation?msg=Create+a+task";
    onOpenChange(false);
    navigate(dest);
  };

  const handleDocumentClick = (documentId: string) => {
    navigate(`/home/memory/documents/${documentId}`);
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

  const matchesQuery = (haystack: string) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return haystack.toLowerCase().includes(q);
  };

  const filteredNavItems = NAV_ITEMS.filter((item) =>
    matchesQuery(item.label),
  );

  // "Go to {agent}" — one entry per active workspace agent, filtered by
  // the current search query on displayName OR handle so users can type
  // either "cass" or "Cass Coder".
  const filteredAgentTargets = agentTargets.filter((a) =>
    matchesQuery(`go to ${a.displayName} ${a.handle}`),
  );

  const actionItems = [
    { label: "Add Task", icon: Task, onSelect: handleAddTask },
    { label: "Add Document", icon: Plus, onSelect: handleAddDocument },
  ].filter((action) => matchesQuery(action.label));

  const filteredCodingTargets = codingTargets.filter((target) =>
    matchesQuery(
      `new session ${target.agent} ${target.gatewayName}`,
    ),
  );

  return (
    <>
      {/* NewSessionDialog renders here, not inside CommandDialog — when
          the command-bar closes on selection its children unmount, so the
          dialog has to be a sibling to outlive that. */}
      <NewSessionDialog
        open={pendingTarget !== null}
        onOpenChange={(v) => {
          if (!v) setPendingTarget(null);
        }}
        initialGatewayId={pendingTarget?.gatewayId}
        initialAgent={pendingTarget?.agent}
        onCreated={handleSessionCreated}
      />

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

          {filteredNavItems.length > 0 && (
            <CommandGroup heading="Navigate" className="p-2">
              {filteredNavItems.map((item) => (
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
          )}

          {/* One "Go to <Agent>" per active workspace agent. Chat with an
              agent = go to their conversation. */}
          {filteredAgentTargets.length > 0 && (
            <>
              {filteredNavItems.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Agents" className="p-2">
                {filteredAgentTargets.map((a) => (
                  <CommandItem
                    key={a.handle}
                    value={`agent-${a.handle}`}
                    onSelect={() => {
                      navigate(`/home/conversation/${a.handle}`);
                      onOpenChange(false);
                    }}
                    className="flex items-center gap-2 py-1"
                  >
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span className="flex-1">Go to {a.displayName}</span>
                    <span className="text-muted-foreground text-xs">
                      @{a.handle}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {actionItems.length > 0 && (
            <>
              {filteredNavItems.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Actions" className="p-2">
                {actionItems.map((action) => (
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
            </>
          )}

          {/* Coding sessions (one item per gateway × agent that's connected
              and has a coding-scoped folder). */}
          {filteredCodingTargets.length > 0 && (
            <>
              {(filteredNavItems.length > 0 || actionItems.length > 0) && (
                <CommandSeparator />
              )}
              <CommandGroup heading="New coding session" className="p-2">
                {filteredCodingTargets.map((target) => {
                  const key = `${target.gatewayId}:${target.agent}`;
                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => handleNewCodingSession(target)}
                      className="flex items-center gap-2 py-1"
                    >
                      <Terminal className="mr-2 h-4 w-4" />
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

          {/* Documents — hide the heading entirely when a search returned
              nothing; CommandEmpty above already handles the empty-state
              message. */}
          {(isSearching ||
            documentResults.length > 0 ||
            debouncedQuery.length < 2) && (
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
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

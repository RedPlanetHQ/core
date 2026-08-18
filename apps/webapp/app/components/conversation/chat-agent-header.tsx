import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "@remix-run/react";
import {
  ChevronDown,
  Clock,
  MoreHorizontal,
  Pencil,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { SamAvatar } from "../ui/sam-avatar";
import { PageHeader } from "../common/page-header";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface AgentLite {
  id: string;
  handle: string;
  displayName: string;
  kind: "system" | "gateway" | "user";
  gatewayId: string | null;
  appearance: { eye: string; eyeColor: string; accentColor: string };
}

interface ConversationListItem {
  id: string;
  source: string;
  title: string | null;
  updatedAt: string;
  unread: boolean;
}

/** Human-friendly label for a Conversation.source string. */
function formatSourceLabel(source: string): string {
  if (source === "core") return "Dashboard";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * Chat header — composes PageHeader. Breadcrumb → agent switcher (left of
 * title area) → History popover + three-dot menu (right). The agent switcher
 * uses the standard Button style (no pill / rounded-full) so it visually
 * matches the History and More buttons on the right side.
 */
export function ChatAgentHeader() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const currentHandle = params.handle ?? null;
  const currentSource = searchParams.get("src") ?? "core";

  const [agents, setAgents] = useState<AgentLite[] | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ConversationListItem[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/agents");
      if (!res.ok) return;
      const body = (await res.json()) as { agents?: AgentLite[] };
      setAgents(body.agents ?? []);
    } catch {
      /* leave list */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const current =
    (agents && currentHandle
      ? agents.find((a) => a.handle === currentHandle)
      : null) ??
    (agents ? agents.find((a) => a.kind === "system") : null) ??
    null;

  const selectAgent = (handle: string) => {
    navigate(`/home/conversation/${handle}`);
    setSwitcherOpen(false);
  };

  useEffect(() => {
    if (!historyOpen || !current) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/agents/${current.id}/conversations`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          conversations?: ConversationListItem[];
        };
        if (!cancelled) setHistory(body.conversations ?? []);
      } catch {
        /* leave */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen, current]);

  const selectSource = (source: string) => {
    if (!currentHandle) return;
    const path = `/home/conversation/${currentHandle}`;
    if (source === "core") navigate(path);
    else navigate(`${path}?src=${encodeURIComponent(source)}`);
    setHistoryOpen(false);
  };

  // System (generalist) agent is undeletable. Gateway agents get archived by
  // the API rather than hard-deleted; user agents are removed outright. In
  // both non-system cases we bounce back to /home/conversation which
  // re-resolves to the generalist thread.
  const canDelete = current && current.kind !== "system";
  const deleteVerb = current?.kind === "gateway" ? "Archive" : "Delete";

  const handleDelete = async () => {
    if (!current) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/agents/${current.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setIsDeleting(false);
        return;
      }
      setDeleteOpen(false);
      setIsDeleting(false);
      navigate("/home/conversation");
    } catch {
      setIsDeleting(false);
    }
  };

  const agentSwitcher = (
    <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="ml-2 flex items-center gap-1.5 rounded">
          {current ? (
            current.kind === "gateway" ? (
              <Server size={14} />
            ) : (
              <SamAvatar
                size={20}
                eye={current.appearance.eye}
                eyeColor={current.appearance.eyeColor}
              />
            )
          ) : (
            <div className="bg-muted h-4 w-4 rounded-sm" />
          )}
          <span className="text-sm">{current?.displayName ?? "Agent"}</span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search agents" />
            <CommandList>
              <CommandEmpty>No agents.</CommandEmpty>
              <CommandGroup heading="AI teammates">
                {agents?.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.displayName} ${a.handle}`}
                    onSelect={() => selectAgent(a.handle)}
                    className="flex items-center gap-2"
                  >
                    {a.kind === "gateway" ? (
                      <Server size={18} />
                    ) : (
                      <SamAvatar
                        size={22}
                        eye={a.appearance.eye}
                        eyeColor={a.appearance.eyeColor}
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {a.displayName}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        @{a.handle}
                      </span>
                    </div>
                    {current?.id === a.id && (
                      <span className="text-primary text-xs">✓</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );

  const rightActions = (
    <>
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded"
            title="History"
          >
            <Clock size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">History</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setHistoryOpen(false)}
              >
                <X size={12} />
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto p-1">
              {history === null && (
                <div className="text-muted-foreground p-3 text-xs">
                  Loading…
                </div>
              )}
              {history?.length === 0 && (
                <div className="text-muted-foreground p-3 text-xs">
                  No conversations yet.
                </div>
              )}
              {history?.map((c) => {
                const active = c.source === currentSource;
                const title =
                  (c.title
                    ? c.title.replace(/<[^>]*>/g, "").trim()
                    : "") || formatSourceLabel(c.source);
                return (
                  <Button
                    key={c.id}
                    variant={active ? "secondary" : "ghost"}
                    isActive={active}
                    full
                    onClick={() => selectSource(c.source)}
                    className="text-foreground h-auto justify-start rounded p-2 py-1 text-left"
                  >
                    <span className="min-w-0 grow truncate text-left text-sm">
                      {title}
                    </span>
                    {c.unread && (
                      <span className="bg-primary ml-2 h-1.5 w-1.5 shrink-0 rounded-full" />
                    )}
                  </Button>
                );
              })}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded"
            title="More"
          >
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={!current}
            onClick={() => current && navigate(`/home/agents/${current.id}`)}
            className="flex items-center gap-2"
          >
            <Pencil size={14} />
            Edit agent
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="text-destructive focus:text-destructive flex items-center gap-2"
              >
                <Trash2 size={14} />
                {deleteVerb} agent
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteVerb} {current?.displayName ?? "agent"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {current?.kind === "gateway"
                ? `The "${current.displayName}" gateway agent will be archived. Reconnect the gateway to bring it back.`
                : `The "${current?.displayName ?? "agent"}" agent will be permanently removed along with its threads.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Working…" : deleteVerb}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return (
    <PageHeader
      title="Chat"
      breadcrumbs={[{ label: "Chat" }]}
      leftActionsNode={agentSwitcher}
      actionsNode={rightActions}
    />
  );
}

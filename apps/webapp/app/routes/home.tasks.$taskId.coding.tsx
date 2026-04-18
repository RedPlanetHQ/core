import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate, useParams } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { useRef, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Terminal, Loader2, Plus, Copy, Check } from "lucide-react";

import { EditorContent, useEditor } from "@tiptap/react";
import { extensionsForConversation } from "~/components/conversation/editor-extensions";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getCodingSessionsForTask } from "~/services/coding/coding-session.server";
import type { CodingSessionListItem } from "~/services/coding/coding-session.server";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { useTauri } from "~/hooks/use-tauri";
import { TauriTerminal } from "~/components/coding/tauri-terminal";
import { NewSessionDialog } from "~/components/coding/new-session-dialog";
import { useSetCodingActions } from "~/components/coding/coding-actions-context";
import { useSidebar } from "~/components/ui/sidebar";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { taskId } = params;
  if (!taskId) return redirect("/home/tasks");

  const sessions = await getCodingSessionsForTask(taskId, workspaceId);
  return typedjson({ sessions });
}

// ─── Turn bubble ──────────────────────────────────────────────────────────────

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

function AssistantContent({ content }: { content: string }) {
  const editor = useEditor({
    extensions: extensionsForConversation,
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: "focus:outline-none text-sm",
      },
    },
  });

  return (
    <EditorContent
      editor={editor}
      className="prose-sm max-w-full [&_.tiptap]:outline-none"
    />
  );
}

function TurnBubble({ turn }: { turn: ConversationTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-grayAlpha-100 max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2.5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {turn.content}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-full">
      <AssistantContent content={turn.content} />
    </div>
  );
}

// ─── Session detail ───────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000;
const NEAR_BOTTOM_THRESHOLD = 80;

function SessionDetail({
  session,
  onOpenChat,
}: {
  session: CodingSessionListItem;
  onOpenChat: () => void;
}) {
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [running, setRunning] = useState(false);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopySessionId = () => {
    const idToCopy = session.externalSessionId ?? session.id;
    navigator.clipboard.writeText(idToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTurnCountRef = useRef(0);
  const canPoll = !!session.gatewayId && !!session.externalSessionId;

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return (
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
    );
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const fetchTurns = useCallback(async () => {
    if (!canPoll) return;
    try {
      const res = await fetch(`/api/v1/coding-sessions/${session.id}/logs`);
      const data = await res.json();
      if (data.error) {
        setTurnsError(data.error);
      } else {
        const newTurns: ConversationTurn[] = data.turns ?? [];
        const wasNearBottom = isNearBottom();
        const prevCount = prevTurnCountRef.current;
        setTurns(newTurns);
        setRunning(data.running ?? false);
        setTurnsError(null);

        if (newTurns.length > prevCount && wasNearBottom) {
          requestAnimationFrame(() => scrollToBottom());
        }
        prevTurnCountRef.current = newTurns.length;
      }
    } catch {
      setTurnsError("Failed to fetch session");
    }
  }, [session.id, canPoll, isNearBottom, scrollToBottom]);

  useEffect(() => {
    prevTurnCountRef.current = 0;
    setTurns(null);
    setRunning(false);
    fetchTurns().then(() => {
      requestAnimationFrame(() => scrollToBottom("instant" as ScrollBehavior));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    if (!canPoll) return;
    const id = setInterval(fetchTurns, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchTurns, canPoll]);

  return (
    <div className="mb-1 flex h-full flex-col">
      <div className="border-border flex shrink-0 items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {format(new Date(session.createdAt), "EEEE, MMMM d · h:mm a")}
          </span>
          <Badge variant="secondary" className="text-xs">
            {session.agent}
          </Badge>
          {session.worktreeBranch && (
            <span className="text-muted-foreground font-mono text-xs">
              {session.worktreeBranch}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded"
            onClick={handleCopySessionId}
            title="Copy session ID"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </Button>
          {running && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Loader2 size={11} className="animate-spin" />
              Running
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
      >
        {!canPoll ? (
          <p className="text-muted-foreground text-sm">
            No gateway linked to this session.
          </p>
        ) : turnsError ? (
          <p className="text-destructive text-sm">{turnsError}</p>
        ) : turns === null ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : turns.length === 0 ? (
          <p className="text-muted-foreground text-sm">No messages yet.</p>
        ) : (
          turns.map((turn, i) => <TurnBubble key={i} turn={turn} />)
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function CodingPage() {
  const { sessions: initialSessions } = useTypedLoaderData<typeof loader>();
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { isDesktop, invoke } = useTauri();
  const setCodingActions = useSetCodingActions();
  const { setOpen: setSidebarOpen } = useSidebar();
  // null = not yet checked, "" = installed, string = error message
  const [corebrainError, setCorebrainError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    invoke("check_corebrain_installed")
      .then(() => setCorebrainError(""))
      .catch((err: unknown) => setCorebrainError(String(err)));
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local session list — can grow when new sessions are created from the dialog
  const [sessions, setSessions] =
    useState<CodingSessionListItem[]>(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSessions[0]?.id ?? null,
  );

  // Increment to force-remount TauriTerminal (e.g. on resume)
  const [terminalKey, setTerminalKey] = useState(0);

  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const selectedSession =
    sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  const handleNewSessionCreated = (
    sessionId: string,
    agent: string,
    dir: string,
  ) => {
    const newSession: CodingSessionListItem = {
      id: sessionId,
      agent,
      dir,
      createdAt: new Date(),
      updatedAt: new Date(),
      prompt: null,
      externalSessionId: null,
      conversationId: null,
      gatewayId: null,
      worktreePath: null,
      worktreeBranch: null,
      gateway: null,
    };
    setSessions((prev) => [newSession, ...prev]);
    setSelectedId(sessionId);
    setTerminalKey((k) => k + 1);
  };

  const handleSessionIdUpdated = (sessionDbId: string, extId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionDbId ? { ...s, externalSessionId: extId } : s,
      ),
    );
  };

  const handleResumeSession = (extId: string) => {
    // Ensure parent state has the extId before remounting, so spawn_pty
    // receives resumeSessionId instead of falling back to reconnect logic.
    if (selectedId) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === selectedId ? { ...s, externalSessionId: extId } : s,
        ),
      );
    }
    setTerminalKey((k) => k + 1);
  };

  const lastDir = sessions.find((s) => s.dir)?.dir ?? "";

  // Auto-collapse sidebar on mount, restore on unmount
  useEffect(() => {
    setSidebarOpen(false);
    return () => setSidebarOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register actions in the PageHeader (re-register whenever sessions/selectedId change)
  useEffect(() => {
    setCodingActions({
      onNewSession: () => setNewSessionOpen(true),
      sessions,
      selectedId,
      onSelectSession: (id) => {
        setSelectedId(id);
        setTerminalKey((k) => k + 1);
      },
    });
    return () => setCodingActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, selectedId]);

  if (isDesktop && corebrainError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8">
        <Terminal className="text-muted-foreground h-8 w-8" />
        <p className="text-foreground text-sm font-medium">
          corebrain CLI not found
        </p>
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          Install it to enable coding sessions:
        </p>
        <code className="bg-muted rounded px-3 py-1.5 font-mono text-sm">
          npm install -g @redplanethq/corebrain
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            invoke("check_corebrain_installed")
              .then(() => setCorebrainError(""))
              .catch((err: unknown) => setCorebrainError(String(err)))
          }
        >
          Check again
        </Button>
      </div>
    );
  }

  if (sessions.length === 0 && !isDesktop) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Terminal className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No coding sessions yet</p>
      </div>
    );
  }

  if (sessions.length === 0 && isDesktop) {
    return (
      <>
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <Terminal className="text-muted-foreground h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No coding sessions yet
          </p>
          <Button variant="secondary" onClick={() => setNewSessionOpen(true)}>
            <Plus size={14} className="mr-1" />
            New session
          </Button>
        </div>
        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          taskId={taskId!}
          defaultDir={lastDir}
          onCreated={handleNewSessionCreated}
        />
      </>
    );
  }

  const showTerminal = isDesktop && selectedSession !== null;

  return (
    <>
      <div className="h-full w-full overflow-hidden">
        {selectedSession ? (
          showTerminal ? (
            <TauriTerminal
              key={`${selectedSession.id}-${terminalKey}`}
              sessionDbId={selectedSession.id}
              agent={selectedSession.agent}
              dir={selectedSession.worktreePath ?? selectedSession.dir ?? ""}
              externalSessionId={selectedSession.externalSessionId ?? undefined}
              onNewSession={() => setNewSessionOpen(true)}
              onResumeSession={handleResumeSession}
              onSessionIdUpdated={handleSessionIdUpdated}
            />
          ) : (
            <SessionDetail
              session={selectedSession}
              onOpenChat={() =>
                navigate(`/home/conversation/${selectedSession.conversationId}`)
              }
            />
          )
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Select a session
          </div>
        )}
      </div>

      {isDesktop && (
        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          taskId={taskId!}
          defaultDir={lastDir}
          onCreated={handleNewSessionCreated}
        />
      )}
    </>
  );
}

export default function TaskCodingPage() {
  if (typeof window === "undefined") return null;
  return <ClientOnly fallback={null}>{() => <CodingPage />}</ClientOnly>;
}

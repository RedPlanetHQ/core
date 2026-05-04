import { useNavigate, useOutletContext, useParams } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, Copy, Check } from "lucide-react";

import { EditorContent, useEditor } from "@tiptap/react";
import { extensionsForConversation } from "~/components/conversation/editor-extensions";
import type { CodingSessionListItem } from "~/services/coding/coding-session.server";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { GatewayTerminal } from "~/components/coding/gateway-terminal";
import type { CodingOutletContext } from "./home.tasks.$taskId.coding";
import { lastSessionStorageKey } from "./home.tasks.$taskId.coding._index";

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

const POLL_INTERVAL = 5000;
const NEAR_BOTTOM_THRESHOLD = 80;

function SessionDetail({ session }: { session: CodingSessionListItem }) {
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
        {!session.gatewayId ? (
          <p className="text-muted-foreground text-sm">
            No gateway linked to this session.
          </p>
        ) : !session.externalSessionId ? (
          <p className="text-muted-foreground text-sm">
            Session ready. Send a prompt from the conversation to start the
            agent.
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

export default function CodingSessionRoute() {
  const { sessions, taskId, openNewSession } =
    useOutletContext<CodingOutletContext>();
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const session = sessions.find((s) => s.id === sessionId) ?? null;

  // Remember the last-viewed session per task so reopening the Coding tab
  // resumes here instead of falling back to the most-recent session.
  useEffect(() => {
    if (!sessionId || !session) return;
    try {
      window.localStorage.setItem(lastSessionStorageKey(taskId), sessionId);
    } catch {
      // localStorage unavailable (private mode, etc.) — best-effort, ignore.
    }
  }, [sessionId, session, taskId]);

  // Stale URL (session deleted, or wrong taskId): bounce back to the index so
  // it can pick a valid session.
  useEffect(() => {
    if (sessionId && !session && sessions.length > 0) {
      navigate(`/home/tasks/${taskId}/coding`, { replace: true });
    }
  }, [sessionId, session, sessions.length, navigate, taskId]);

  if (!session) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Session not found
      </div>
    );
  }

  const showTerminal =
    Boolean(session.gatewayId) && Boolean(session.externalSessionId);

  if (showTerminal) {
    return (
      <GatewayTerminal
        key={session.id}
        codingSessionId={session.id}
        onNewSession={openNewSession}
        initialPrompt={session.prompt ?? undefined}
      />
    );
  }

  return <SessionDetail session={session} />;
}

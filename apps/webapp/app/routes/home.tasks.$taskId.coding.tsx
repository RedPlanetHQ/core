import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  AutoSizer,
  List,
  CellMeasurer,
  CellMeasurerCache,
  type ListRowProps,
  type Index,
} from "react-virtualized";
import { format } from "date-fns";
import { ExternalLink, Terminal } from "lucide-react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getCodingSessionsForTask } from "~/services/coding/coding-session.server";
import type { CodingSessionListItem } from "~/services/coding/coding-session.server";
import { StyledMarkdown } from "~/components/common/styled-markdown";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

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

// ─── Session list item ────────────────────────────────────────────────────────

function SessionListItem({
  session,
  selected,
  index,
  total,
  onClick,
}: {
  session: CodingSessionListItem;
  selected: boolean;
  onClick: () => void;
  index: number;
  total: number;
}) {
  return (
    <div
      className={cn(
        "p-2 py-1",
        index === 0 && "pt-2",
        index === total - 1 && "pb-2",
      )}
    >
      <button
        onClick={onClick}
        className={cn(
          "border-border hover:bg-grayAlpha-100 flex w-full flex-col gap-1 rounded border-b px-4 py-3 text-left transition-colors",
          selected && "bg-grayAlpha-100",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {format(new Date(session.createdAt), "MMM d, yyyy")}
          </span>
          <Badge variant="secondary" className="text-xs">
            {session.agent}
          </Badge>
        </div>
        {session.prompt && (
          <span className="text-muted-foreground line-clamp-1 text-xs">
            {session.prompt.slice(0, 60)}
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {format(new Date(session.createdAt), "h:mm a")}
        </span>
      </button>
    </div>
  );
}

// ─── Session detail ───────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000;

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

function TurnBubble({ turn }: { turn: ConversationTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-grayAlpha-100 max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">Assistant</span>
      <div className="text-sm leading-relaxed">
        <StyledMarkdown>{turn.content}</StyledMarkdown>
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  onOpenChat,
}: {
  session: CodingSessionListItem;
  onOpenChat: () => void;
}) {
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  const turnsEndRef = useRef<HTMLDivElement>(null);
  const canPoll = !!session.gatewayId && !!session.externalSessionId;

  const fetchTurns = useCallback(async () => {
    if (!canPoll) return;
    try {
      const res = await fetch(`/api/v1/coding-sessions/${session.id}/logs`);
      const data = await res.json();
      if (data.error) {
        setTurnsError(data.error);
      } else {
        setTurns(data.turns ?? []);
        setTurnsError(null);
      }
    } catch {
      setTurnsError("Failed to fetch session");
    }
  }, [session.id, canPoll]);

  useEffect(() => {
    fetchTurns();
    if (!canPoll) return;
    const id = setInterval(fetchTurns, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchTurns, canPoll]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex shrink-0 items-start justify-between gap-4 border-b p-6 pb-4">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">
            {format(new Date(session.createdAt), "EEEE, MMMM d, yyyy · h:mm a")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {session.agent}
            </Badge>
            {session.gateway && (
              <span className="text-muted-foreground text-xs">
                via {session.gateway.name}
              </span>
            )}
            {session.worktreeBranch && (
              <span className="text-muted-foreground font-mono text-xs">
                {session.worktreeBranch}
              </span>
            )}
            {session.dir && (
              <span className="text-muted-foreground font-mono text-xs">
                {session.dir}
              </span>
            )}
          </div>
        </div>
        {session.conversationId && (
          <Button
            variant="secondary"
            className="shrink-0 gap-1.5 rounded"
            onClick={onOpenChat}
          >
            <ExternalLink size={14} />
            Open chat
          </Button>
        )}
      </div>

      {/* Conversation turns */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {!canPoll ? (
          <p className="text-muted-foreground text-sm">No gateway linked to this session.</p>
        ) : turnsError ? (
          <p className="text-destructive text-sm">{turnsError}</p>
        ) : turns === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : turns.length === 0 ? (
          <p className="text-muted-foreground text-sm">No messages yet.</p>
        ) : (
          turns.map((turn, i) => <TurnBubble key={i} turn={turn} />)
        )}
        <div ref={turnsEndRef} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function CodingPage() {
  const { sessions } = useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(
    sessions[0]?.id ?? null,
  );

  const selectedSession =
    sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 80, fixedWidth: true }),
  );
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [sessions.length]);

  const rowHeight = ({ index }: Index) =>
    Math.max(cache.getHeight(index, 0), 80);

  const rowRenderer = useCallback(
    ({ index, key, style, parent: listParent }: ListRowProps) => {
      const session = sessions[index];
      if (!session) return null;
      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={listParent}
          rowIndex={index}
        >
          <div style={style}>
            <SessionListItem
              session={session}
              index={index}
              total={sessions.length}
              selected={session.id === selectedId}
              onClick={() => setSelectedId(session.id)}
            />
          </div>
        </CellMeasurer>
      );
    },
    [sessions, selectedId, cache],
  );

  if (sessions.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Terminal className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground">No coding sessions yet</p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize="20%" minSize="20%" maxSize="35%">
        <div className="flex h-full flex-col">
          <div className="border-border border-b px-4 py-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <AutoSizer>
              {({ width, height }) => (
                <List
                  height={height}
                  width={width}
                  rowCount={sessions.length}
                  rowHeight={rowHeight}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache}
                  overscanRowCount={8}
                />
              )}
            </AutoSizer>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize="65" minSize="50%">
        {selectedSession ? (
          <SessionDetail
            session={selectedSession}
            onOpenChat={() =>
              navigate(`/home/conversation/${selectedSession.conversationId}`)
            }
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Select a session
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export default function TaskCodingPage() {
  if (typeof window === "undefined") return null;
  return <ClientOnly fallback={null}>{() => <CodingPage />}</ClientOnly>;
}

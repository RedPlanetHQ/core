import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, LoaderCircle, PlayCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ConversationView } from "~/components/conversation";
import { cn } from "~/lib/utils";

interface TaskChatPanelProps {
  taskId: string;
  /** Task's currently-assigned agent id. Triggers a reload when the assignee
   *  changes so the pane switches to the new agent's own (task, agent)
   *  thread. Ignored for recurring tasks — each run is its own conversation. */
  assignedAgentId: string | null;
  /** True when the task has an RRule schedule. Recurring tasks show a runs
   *  list first; one-shot tasks open the single (task, agent) chat directly. */
  isRecurring: boolean;
  integrationAccountMap: Record<string, string>;
}

interface TaskConversationResponse {
  conversation: {
    id: string;
    status: string;
    ConversationHistory: Array<{
      id: string;
      userType: string;
      message: string;
      parts: any[];
    }>;
    hasMore: boolean;
    nextCursor: string | null;
  } | null;
  agentId: string;
}

interface TaskRun {
  id: string;
  createdAt: string;
  status: string;
  lastMessage: { text: string; userType: string } | null;
}

interface RunHistoryResponse {
  id: string;
  status: string;
  ConversationHistory: Array<{
    id: string;
    userType: string;
    message: string;
    parts: any[];
  }>;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Chat pane next to the task detail view. One-shot tasks open the single
 * (task, agent) conversation directly. Recurring tasks show a runs list;
 * clicking a run drills into that specific run's chat with a back button
 * to return to the list.
 */
export function TaskChatPanel({
  taskId,
  assignedAgentId,
  isRecurring,
  integrationAccountMap,
}: TaskChatPanelProps) {
  const homeData = useRouteLoaderData("routes/home") as any;
  const models = homeData?.models ?? [];

  // Active workspace agents for the @-mention picker. Task conversations
  // support collaboration, so the picker is on here and lists everyone
  // except gateway-backed rows (infrastructure, not chatteable).
  const [colleagues, setColleagues] = useState<
    Array<{
      id: string;
      handle: string;
      displayName: string;
      appearance?: {
        eye?: string;
        eyeColor?: string;
        accentColor?: string;
      } | null;
    }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/agents");
        if (!res.ok) return;
        const body = (await res.json()) as {
          agents?: Array<{
            id: string;
            handle: string;
            displayName: string;
            status: string;
            kind: string;
            appearance?: {
              eye?: string;
              eyeColor?: string;
              accentColor?: string;
            } | null;
          }>;
        };
        if (cancelled) return;
        setColleagues(
          (body.agents ?? [])
            .filter((a) => a.status === "Active" && a.kind !== "gateway")
            .map((a) => ({
              id: a.id,
              handle: a.handle,
              displayName: a.displayName,
              appearance: a.appearance ?? null,
            })),
        );
      } catch {
        /* leave list empty on transient failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isRecurring ? (
    <RecurringChat
      taskId={taskId}
      integrationAccountMap={integrationAccountMap}
      models={models}
      colleagues={colleagues}
    />
  ) : (
    <OneShotChat
      taskId={taskId}
      assignedAgentId={assignedAgentId}
      integrationAccountMap={integrationAccountMap}
      models={models}
      colleagues={colleagues}
    />
  );
}

// ─── One-shot: single (task, agent) conversation ────────────────────────────
function OneShotChat({
  taskId,
  assignedAgentId,
  integrationAccountMap,
  models,
  colleagues,
}: {
  taskId: string;
  assignedAgentId: string | null;
  integrationAccountMap: Record<string, string>;
  models: any[];
  colleagues: Array<{ id: string; handle: string; displayName: string; appearance?: { eye?: string; eyeColor?: string; accentColor?: string } | null }>;
}) {
  const fetcher = useFetcher<TaskConversationResponse>();
  const [active, setActive] = useState<{
    conversationId: string;
    status: string | undefined;
    history: Array<{
      id: string;
      userType: string;
      message: string;
      parts: any[];
    }>;
    hasMore: boolean;
    nextCursor: string | null;
  } | null>(null);

  useEffect(() => {
    fetcher.load(`/api/v1/tasks/${taskId}/conversation`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, assignedAgentId]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.conversation) {
      const conv = fetcher.data.conversation;
      setActive({
        conversationId: conv.id,
        status: conv.status,
        history: conv.ConversationHistory ?? [],
        hasMore: conv.hasMore ?? false,
        nextCursor: conv.nextCursor ?? null,
      });
    }
  }, [fetcher.state, fetcher.data]);

  if (!active) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <LoaderCircle className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <ConversationView
        key={active.conversationId}
        conversationId={active.conversationId}
        history={active.history}
        hasMore={active.hasMore}
        nextCursor={active.nextCursor}
        conversationStatus={active.status}
        autoRegenerate
        integrationAccountMap={integrationAccountMap}
        models={models}
        colleagues={colleagues}
        enableMentionPicker
      />
    </div>
  );
}

// ─── Recurring: runs list, then drill into a run's chat ─────────────────────
function RecurringChat({
  taskId,
  integrationAccountMap,
  models,
  colleagues,
}: {
  taskId: string;
  integrationAccountMap: Record<string, string>;
  models: any[];
  colleagues: Array<{ id: string; handle: string; displayName: string; appearance?: { eye?: string; eyeColor?: string; accentColor?: string } | null }>;
}) {
  const runsFetcher = useFetcher<{ runs: TaskRun[] }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    runsFetcher.load(`/api/v1/tasks/${taskId}/runs`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const runs = runsFetcher.data?.runs ?? null;

  if (selectedRunId) {
    return (
      <RunChat
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
        integrationAccountMap={integrationAccountMap}
        models={models}
        colleagues={colleagues}
      />
    );
  }

  if (runs === null) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <LoaderCircle className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3">
        <PlayCircle className="text-muted-foreground h-8 w-8" />
        <p className="text-muted-foreground text-sm">No runs yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b px-4 py-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {runs.map((run, index) => (
          <RunRow
            key={run.id}
            run={run}
            index={index}
            total={runs.length}
            onClick={() => setSelectedRunId(run.id)}
          />
        ))}
      </div>
    </div>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-500/20 text-green-600",
  running: "bg-blue-500/20 text-blue-600",
  failed: "bg-red-500/20 text-red-600",
  pending: "bg-gray-500/20 text-gray-600",
};

function RunRow({
  run,
  index,
  total,
  onClick,
}: {
  run: TaskRun;
  index: number;
  total: number;
  onClick: () => void;
}) {
  const hint = run.lastMessage?.text?.trim() ?? "";
  return (
    <div
      className={cn(
        "p-2 py-1",
        index === 0 && "pt-2",
        index === total - 1 && "pb-2",
      )}
    >
      <Button
        variant="ghost"
        onClick={onClick}
        className="border-border hover:bg-grayAlpha-100 flex h-auto w-full flex-col items-stretch gap-1 rounded border-b px-4 py-3 text-left transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {format(new Date(run.createdAt), "MMM d, yyyy")}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              "text-xs capitalize",
              RUN_STATUS_COLOR[run.status] ?? "",
            )}
          >
            {run.status}
          </Badge>
        </div>
        <span className="text-muted-foreground text-xs">
          {format(new Date(run.createdAt), "h:mm a")}
        </span>
        {hint && (
          <span className="text-muted-foreground line-clamp-1 text-xs">
            {hint}
          </span>
        )}
      </Button>
    </div>
  );
}

function RunChat({
  runId,
  onBack,
  integrationAccountMap,
  models,
  colleagues,
}: {
  runId: string;
  onBack: () => void;
  integrationAccountMap: Record<string, string>;
  models: any[];
  colleagues: Array<{ id: string; handle: string; displayName: string; appearance?: { eye?: string; eyeColor?: string; accentColor?: string } | null }>;
}) {
  const fetcher = useFetcher<RunHistoryResponse>();
  const [active, setActive] = useState<{
    conversationId: string;
    status: string | undefined;
    history: Array<{
      id: string;
      userType: string;
      message: string;
      parts: any[];
    }>;
    hasMore: boolean;
    nextCursor: string | null;
  } | null>(null);

  useEffect(() => {
    fetcher.load(`/api/v1/conversation/${runId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.id) {
      const conv = fetcher.data;
      setActive({
        conversationId: conv.id,
        status: conv.status,
        history: conv.ConversationHistory ?? [],
        hasMore: conv.hasMore ?? false,
        nextCursor: conv.nextCursor ?? null,
      });
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-300 px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-7 w-7"
          title="Back to runs"
        >
          <ArrowLeft size={14} />
        </Button>
        <span className="text-sm font-medium">Run</span>
      </div>
      {!active ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <ConversationView
            key={active.conversationId}
            conversationId={active.conversationId}
            history={active.history}
            hasMore={active.hasMore}
            nextCursor={active.nextCursor}
            conversationStatus={active.status}
            autoRegenerate
            integrationAccountMap={integrationAccountMap}
            models={models}
            colleagues={colleagues}
            enableMentionPicker
          />
        </div>
      )}
    </div>
  );
}

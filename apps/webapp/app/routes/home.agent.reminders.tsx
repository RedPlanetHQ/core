import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  Bell,
  Clock,
  Mail,
  MessageSquare,
  MoreVertical,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type ListRowProps,
} from "react-virtualized";
import { PageHeader } from "~/components/common/page-header";
import { prisma } from "~/db.server";
import {
  getUser,
  getWorkspaceId,
  requireUser,
} from "~/services/session.server";
import { cn } from "~/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { updateReminder, deleteReminder } from "~/services/reminder.server";
import { z } from "zod";
import { Button } from "~/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user?.id as string,
    user?.workspaceId,
  );

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = 25;

  const whereClause: any = {
    workspaceId: workspaceId as string,
  };

  if (cursor) {
    whereClause.createdAt = {
      lt: new Date(cursor),
    };
  }

  const [reminders, totalCount] = await Promise.all([
    prisma.reminder.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    }),
    prisma.reminder.count({
      where: { workspaceId: workspaceId as string },
    }),
  ]);

  const hasMore = reminders.length === limit && totalCount > limit;
  const nextCursor =
    reminders.length > 0
      ? reminders[reminders.length - 1].createdAt.toISOString()
      : null;

  return json({
    reminders,
    hasMore,
    nextCursor,
    totalCount,
  });
}

const ActionSchema = z.object({
  intent: z.enum(["toggle", "delete"]),
  reminderId: z.string(),
  isActive: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  const formData = await request.formData();
  const data = ActionSchema.parse({
    intent: formData.get("intent"),
    reminderId: formData.get("reminderId"),
    isActive: formData.get("isActive"),
  });

  if (data.intent === "toggle") {
    const isActive = data.isActive === "true";
    await updateReminder(data.reminderId, workspaceId as string, {
      isActive: !isActive,
    });
    return json({ success: true, action: "toggled" });
  }

  if (data.intent === "delete") {
    await deleteReminder(data.reminderId, workspaceId as string);
    return json({ success: true, action: "deleted" });
  }

  return json({ success: false });
}

interface ReminderItem {
  id: string;
  text: string;
  schedule: string;
  channel: string;
  isActive: boolean;
  nextRunAt: string | null;
  occurrenceCount: number;
  maxOccurrences: number | null;
  createdAt: string;
}

function formatSchedule(
  schedule: string,
  maxOccurrences: number | null,
): string {
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const hourMatch = schedule.match(/BYHOUR=(\d+)/);
  const minuteMatch = schedule.match(/BYMINUTE=(\d+)/);
  const dayMatch = schedule.match(/BYDAY=([A-Z,]+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);

  const freq = freqMatch ? freqMatch[1] : "DAILY";
  const hour = hourMatch ? parseInt(hourMatch[1]) : null;
  const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;
  const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;

  const dayNames: Record<string, string> = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  };

  // Format time string
  let timeStr = "";
  if (hour !== null) {
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    timeStr =
      minute > 0
        ? `${hour12}:${minute.toString().padStart(2, "0")}${ampm}`
        : `${hour12}${ampm}`;
  }

  // One-time reminder
  if (maxOccurrences === 1) {
    if (timeStr) {
      return `Once at ${timeStr}`;
    }
    return "Once";
  }

  let result = "";

  if (freq === "MINUTELY") {
    result = interval > 1 ? `Every ${interval} min` : "Every minute";
  } else if (freq === "HOURLY") {
    result = interval > 1 ? `Every ${interval} hours` : "Hourly";
  } else if (freq === "DAILY") {
    if (dayMatch) {
      const days = dayMatch[1]
        .split(",")
        .map((d) => dayNames[d] || d)
        .join(", ");
      result = days;
    } else {
      result = interval > 1 ? `Every ${interval} days` : "Daily";
    }
  } else if (freq === "WEEKLY") {
    result = interval > 1 ? `Every ${interval} weeks` : "Weekly";
  }

  if (timeStr) {
    result += ` at ${timeStr}`;
  }

  return result || schedule;
}

interface ReminderRowProps {
  reminder: ReminderItem;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}

function ReminderRow({ reminder, onToggle, onDelete }: ReminderRowProps) {
  const ChannelIcon = reminder.channel === "email" ? Mail : MessageSquare;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-gray-300 p-3",
        "bg-background-3 hover:bg-background-3/50 transition-all",
        !reminder.isActive && "opacity-60",
      )}
    >
      {/* Bell Icon */}
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded",
          reminder.isActive ? "bg-primary/10" : "bg-muted",
        )}
      >
        <Bell
          size={16}
          className={
            reminder.isActive ? "text-primary" : "text-muted-foreground"
          }
        />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-medium">{reminder.text}</p>
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          {/* Schedule */}
          <div className="flex items-center gap-1">
            <Clock size={12} />
            <span>
              {formatSchedule(reminder.schedule, reminder.maxOccurrences)}
            </span>
          </div>

          {/* Channel */}
          <div className="flex items-center gap-1">
            <ChannelIcon size={12} />
            <span className="capitalize">{reminder.channel}</span>
          </div>

          {/* Occurrences */}
          {reminder.maxOccurrences && (
            <span>
              {reminder.occurrenceCount}/{reminder.maxOccurrences} runs
            </span>
          )}

          {/* Next run */}
          {reminder.isActive && reminder.nextRunAt && (
            <span>
              Next:{" "}
              {formatDistanceToNow(new Date(reminder.nextRunAt), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="rounded"
            onClick={() => onToggle(reminder.id, reminder.isActive)}
          >
            {reminder.isActive ? (
              <>
                <Pause size={14} className="mr-2" />
                Disable
              </>
            ) : (
              <>
                <Play size={14} className="mr-2" />
                Enable
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(reminder.id)}
            className="text-red-600 focus:text-red-600"
          >
            <Trash2 size={14} className="mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function Reminders() {
  const initialData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof loader>();
  const actionFetcher = useFetcher();

  const [reminders, setReminders] = useState<ReminderItem[]>(
    initialData.reminders as unknown as ReminderItem[],
  );
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [isLoading, setIsLoading] = useState(false);

  const cacheRef = useRef<CellMeasurerCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new CellMeasurerCache({
      defaultHeight: 88,
      fixedWidth: true,
    });
  }
  const cache = cacheRef.current;

  // Handle toggle
  const handleToggle = useCallback(
    (reminderId: string, isActive: boolean) => {
      // Optimistic update
      setReminders((prev) =>
        prev.map((r) =>
          r.id === reminderId ? { ...r, isActive: !isActive } : r,
        ),
      );

      actionFetcher.submit(
        { intent: "toggle", reminderId, isActive: String(isActive) },
        { method: "POST" },
      );
    },
    [actionFetcher],
  );

  // Handle delete
  const handleDelete = useCallback(
    (reminderId: string) => {
      // Optimistic update
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
      cache.clearAll();

      actionFetcher.submit(
        { intent: "delete", reminderId },
        { method: "POST" },
      );
    },
    [actionFetcher, cache],
  );

  // Load more reminders
  const loadMore = useCallback(() => {
    if (!hasMore || isLoading || !cursor) return;

    setIsLoading(true);
    fetcher.load(`/home/agent/reminders?cursor=${cursor}`);
  }, [hasMore, isLoading, cursor, fetcher]);

  // Handle fetcher data
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      const newReminders = fetcher.data.reminders as unknown as ReminderItem[];
      setReminders((prev) => [...prev, ...newReminders]);
      setHasMore(fetcher.data.hasMore);
      setCursor(fetcher.data.nextCursor);
      setIsLoading(false);
    }
  }, [fetcher.data, fetcher.state]);

  const rowRenderer = useCallback(
    (props: ListRowProps) => {
      const { index, key, style, parent } = props;
      const reminder = reminders[index];

      // Load more when approaching the end
      if (index >= reminders.length - 5 && hasMore && !isLoading) {
        loadMore();
      }

      if (!reminder) {
        return (
          <CellMeasurer
            key={key}
            cache={cache}
            columnIndex={0}
            parent={parent}
            rowIndex={index}
          >
            <div key={key} style={style} className="p-2">
              <div className="h-20 animate-pulse rounded bg-gray-200" />
            </div>
          </CellMeasurer>
        );
      }

      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={parent}
          rowIndex={index}
        >
          <div key={key} style={style} className="px-2 py-1">
            <ReminderRow
              reminder={reminder}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          </div>
        </CellMeasurer>
      );
    },
    [
      reminders,
      hasMore,
      isLoading,
      loadMore,
      cache,
      handleToggle,
      handleDelete,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reminders" />

      <div className="flex h-[calc(100vh)] w-full flex-col p-2 md:h-[calc(100vh_-_56px)]">
        {reminders.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center">
            <div className="bg-primary/10 mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Bell className="text-primary h-6 w-6" />
            </div>
            <h3 className="text-lg font-medium">No reminders yet</h3>
            <p className="text-muted-foreground mt-1 max-w-md text-center text-sm">
              Reminders will appear here when you create them through your agent
              conversations.
            </p>
          </div>
        ) : (
          <div className="h-full grow overflow-hidden rounded-lg">
            <AutoSizer className="h-full">
              {({ width, height }) => (
                <List
                  className="h-auto overflow-auto"
                  height={height}
                  width={width}
                  rowCount={reminders.length}
                  rowHeight={({ index }) => cache.getHeight(index, 0)}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache}
                  overscanRowCount={5}
                />
              )}
            </AutoSizer>
          </div>
        )}
      </div>
    </div>
  );
}

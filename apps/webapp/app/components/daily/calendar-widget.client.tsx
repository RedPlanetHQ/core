import { useCallback, useEffect, useState } from "react";
import { CalendarDays, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import type { CalendarEvent } from "~/routes/api.v1.calendar.today-events";

interface FetchResult {
  events: CalendarEvent[];
  connected: boolean;
  error?: boolean;
}

function formatTime(dateTime: string): string {
  return new Date(dateTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

export function CalendarWidget() {
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const tz = encodeURIComponent(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      const res = await fetch(`/api/v1/calendar/today-events?timezone=${tz}`);
      if (!res.ok) throw new Error("fetch failed");
      setData(await res.json());
    } catch {
      setData({ events: [], connected: true, error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const allDayEvents = data?.events.filter((e) => e.allDay) ?? [];
  const timedEvents = data?.events.filter((e) => !e.allDay) ?? [];

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <CalendarDays size={13} className="text-muted-foreground shrink-0" />
        <span className="text-muted-foreground flex-1 truncate text-xs font-medium">
          Today's Events
        </span>
        {!loading && (
          <button
            onClick={fetchEvents}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-6">
          <LoaderCircle size={16} className="text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Not connected */}
      {!loading && data && !data.connected && (
        <div className="px-3 py-4 text-center">
          <p className="text-muted-foreground text-xs">
            Connect Google Calendar to see your events.
          </p>
          <a
            href="/home/integrations"
            className="text-primary mt-1 inline-block text-xs underline"
          >
            Connect
          </a>
        </div>
      )}

      {/* Error */}
      {!loading && data?.connected && data.error && (
        <div className="px-3 py-4 text-center">
          <p className="text-muted-foreground text-xs">
            Could not load events.
          </p>
          <button
            onClick={fetchEvents}
            className="text-primary mt-1 text-xs underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && data?.connected && !data.error && data.events.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-6">
          <CalendarDays size={20} className="text-muted-foreground" />
          <p className="text-muted-foreground text-xs">No events today</p>
        </div>
      )}

      {/* Event list */}
      {!loading && data?.connected && !data.error && data.events.length > 0 && (
        <div className="flex flex-col">
          {allDayEvents.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {timedEvents.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const timeLabel = event.allDay
    ? "All day"
    : event.start.dateTime
      ? formatTime(event.start.dateTime)
      : "";

  const content = (
    <div className="hover:bg-grayAlpha-50 flex items-start gap-2 border-b border-gray-100 px-3 py-2 last:border-0 dark:border-gray-800">
      <span
        className={
          event.allDay
            ? "mt-0.5 shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-200"
            : "text-muted-foreground mt-0.5 w-10 shrink-0 font-mono text-[11px]"
        }
      >
        {timeLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{event.summary}</p>
        {event.location && (
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
            <MapPin size={9} className="shrink-0" />
            <span className="truncate text-[10px]">{event.location}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (event.htmlLink) {
    return (
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noreferrer"
        className="no-underline"
      >
        {content}
      </a>
    );
  }

  return content;
}

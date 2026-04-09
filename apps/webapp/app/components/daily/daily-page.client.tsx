import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { format, addDays, isToday } from "date-fns";
import { useNavigate } from "@remix-run/react";
import { Button } from "~/components/ui";
import { DayEditor } from "./day-editor.client";

interface PageRecord {
  id: string;
  date: string;
}

interface DailyPageProps {
  butlerName: string;
  workspaceId: string;
  userId: string;
  collabToken: string;
  todayPage?: PageRecord;
  blockedCount?: number;
}

const INITIAL_AFTER = 3;
const LOAD_MORE = 7;
const MAX_DATES = 30;
const SCROLL_THRESHOLD = 800;

function buildInitialDates(today: Date): Date[] {
  return Array.from({ length: INITIAL_AFTER + 1 }, (_, i) => addDays(today, i));
}

function DaySection({
  date,
  butlerName,
  collabToken,
  prefetchedPage,
  blockedCount,
  onRef,
}: {
  date: Date;
  butlerName: string;
  collabToken: string;
  prefetchedPage?: PageRecord;
  blockedCount?: number;
  onRef: (el: HTMLDivElement | null) => void;
}) {
  const [page, setPage] = React.useState<PageRecord | null>(
    prefetchedPage ?? null,
  );
  const [loading, setLoading] = React.useState(!prefetchedPage);
  const today = isToday(date);
  const navigate = useNavigate();

  React.useEffect(() => {
    if (prefetchedPage) return;
    const dateStr = format(date, "yyyy-MM-dd");
    fetch(`/api/v1/page?date=${dateStr}`)
      .then((r) => r.json())
      .then((p) => {
        setPage(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={onRef}
      className={`mb-8 px-2 pt-6 ${today ? "min-h-[60vh]" : ""}`}
    >
      <div className="mb-3 flex items-center gap-3">
        <h2
          className={`text-2xl font-medium ${
            today ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {format(date, "EEE, MMMM do, yyyy")}
          {today && <span className="text-primary ml-2">•</span>}
        </h2>
        {today && blockedCount != null && blockedCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              const saved = localStorage.getItem("userSettings");
              const parsed = saved ? JSON.parse(saved) : {};
              localStorage.setItem(
                "userSettings",
                JSON.stringify({ ...parsed, "task-view-filter": ["Blocked"] }),
              );
              navigate("/home/tasks");
            }}
          >
            {blockedCount} blocked
          </Button>
        )}
      </div>

      {loading ? (
        <div className="min-h-[200px]" />
      ) : page ? (
        <DayEditor
          pageId={page.id}
          isToday={today}
          butlerName={butlerName}
          collabToken={collabToken}
        />
      ) : (
        <div className="text-muted-foreground text-sm italic">
          Failed to load page
        </div>
      )}
    </div>
  );
}

export function DailyPage({
  butlerName,
  collabToken,
  todayPage,
  blockedCount,
}: DailyPageProps) {
  const todayDate = useRef(new Date()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);

  const sectionEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const sectionHeights = useRef<Map<string, number>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(
    new Map(),
  );

  const [dates, setDates] = useState<Date[]>(() =>
    buildInitialDates(todayDate),
  );

  // True until the user physically touches the scroll area (wheel or touch).
  // Using wheel/touchstart — NOT the scroll event — because scroll fires for
  // our own programmatic scrollTop changes too, which would falsely unlock.
  const lockedToToday = useRef(true);

  // Guard: prevents cascading prepends while one is in-flight.
  const prependHeightRef = useRef<number | null>(null);
  const appendTrimHeightRef = useRef<number | null>(null);

  const getRefCallback = useCallback((date: Date) => {
    const key = date.toISOString();
    if (!refCallbacks.current.has(key)) {
      refCallbacks.current.set(key, (el) => {
        if (el) {
          sectionEls.current.set(key, el);
          if (isToday(date)) todayRef.current = el;
        } else {
          sectionEls.current.delete(key);
          refCallbacks.current.delete(key);
          if (isToday(date)) todayRef.current = null;
        }
      });
    }
    return refCallbacks.current.get(key)!;
  }, []);

  // Snap directly to today's real DOM position — no delta math.
  const snapToToday = useCallback(() => {
    const container = scrollRef.current;
    const todayEl = todayRef.current;
    if (!container || !todayEl) return;
    container.scrollTop = Math.max(0, todayEl.offsetTop - 26);
  }, []);

  // Delta compensation after prepend / append-trim.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (prependHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    }
    if (appendTrimHeightRef.current !== null) {
      container.scrollTop -=
        appendTrimHeightRef.current - container.scrollHeight;
      appendTrimHeightRef.current = null;
    }
  }, [dates]);

  // ResizeObserver:
  // - Locked: snap to today's real offsetTop (works regardless of content heights).
  // - Unlocked: delta-compensate so past-day content loading doesn't shift the view.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    sectionEls.current.forEach((el, key) => {
      if (!sectionHeights.current.has(key)) {
        sectionHeights.current.set(key, el.offsetHeight);
      }
    });

    const observer = new ResizeObserver((entries) => {
      if (lockedToToday.current) {
        snapToToday();
        return;
      }
      let delta = 0;
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const key = [...sectionEls.current.entries()].find(
          ([, v]) => v === el,
        )?.[0];
        if (!key) continue;
        const prev = sectionHeights.current.get(key) ?? 0;
        const next = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
        sectionHeights.current.set(key, next);
        if (el.offsetTop < container.scrollTop + delta) {
          delta += next - prev;
        }
      }
      if (delta !== 0) container.scrollTop += delta;
    });

    sectionEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dates, snapToToday]);

  // Unlock today-anchor on first physical user interaction.
  // wheel + touchstart cover mouse and touch; NOT the scroll event (which fires
  // for programmatic scrollTop changes too and would falsely unlock).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const unlock = () => {
      lockedToToday.current = false;
    };
    container.addEventListener("wheel", unlock, { passive: true, once: true });
    container.addEventListener("touchstart", unlock, {
      passive: true,
      once: true,
    });
    return () => {
      container.removeEventListener("wheel", unlock);
      container.removeEventListener("touchstart", unlock);
    };
  }, []);

  // Initial silent prepend of past days.
  useEffect(() => {
    const id = setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      prependHeightRef.current = container.scrollHeight;
      setDates((prev) => {
        const oldest = prev[0];
        return [
          ...Array.from({ length: LOAD_MORE }, (_, i) =>
            addDays(oldest, -(LOAD_MORE - i)),
          ),
          ...prev,
        ].slice(0, MAX_DATES);
      });
    }, 150);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const prependDays = useCallback(() => {
    const container = scrollRef.current;
    if (!container || prependHeightRef.current !== null) return;
    prependHeightRef.current = container.scrollHeight;
    setDates((prev) => {
      const oldest = prev[0];
      return [
        ...Array.from({ length: LOAD_MORE }, (_, i) =>
          addDays(oldest, -(LOAD_MORE - i)),
        ),
        ...prev,
      ].slice(0, MAX_DATES);
    });
  }, []);

  const appendDays = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    setDates((prev) => {
      const newest = prev[prev.length - 1];
      const next = [
        ...prev,
        ...Array.from({ length: LOAD_MORE }, (_, i) => addDays(newest, i + 1)),
      ];
      if (next.length > MAX_DATES) {
        appendTrimHeightRef.current = container.scrollHeight;
        return next.slice(-MAX_DATES);
      }
      return next;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (container.scrollTop < SCROLL_THRESHOLD) prependDays();
    if (
      container.scrollHeight - container.scrollTop - container.clientHeight <
      SCROLL_THRESHOLD
    )
      appendDays();
  }, [prependDays, appendDays]);

  return (
    <div className="h-full w-full">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
        }}
        onScroll={handleScroll}
      >
        {dates.map((date) => (
          <DaySection
            key={date.toISOString()}
            date={date}
            butlerName={butlerName}
            collabToken={collabToken}
            prefetchedPage={isToday(date) ? todayPage : undefined}
            blockedCount={isToday(date) ? blockedCount : undefined}
            onRef={getRefCallback(date)}
          />
        ))}
      </div>
    </div>
  );
}

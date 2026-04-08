import React, { useState, useCallback, useRef, useEffect } from "react";
import { Virtuoso } from "react-virtuoso";
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

// Days before and after today in the initial array
const INITIAL_BEFORE = 10;
const INITIAL_AFTER = 5;
const LOAD_MORE = 10;

// Build ascending date array (oldest → newest)
function buildInitialDates(today: Date): Date[] {
  return Array.from({ length: INITIAL_BEFORE + INITIAL_AFTER + 1 }, (_, i) =>
    addDays(today, i - INITIAL_BEFORE),
  );
}

function DaySection({
  date,
  butlerName,
  collabToken,
  prefetchedPage,
  blockedCount,
}: {
  date: Date;
  butlerName: string;
  collabToken: string;
  prefetchedPage?: PageRecord;
  blockedCount?: number;
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
    <div className={`mb-8 ${today ? "min-h-[60vh]" : ""}`}>
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
        <div className="min-h-[400px]" />
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
  const today = useRef(new Date()).current;
  // Callback ref: re-renders when the scroll element mounts, so Virtuoso
  // receives the correct customScrollParent on its very first render.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const [dates, setDates] = useState<Date[]>(() => buildInitialDates(today));
  // firstItemIndex tracks how many items have been prepended so Virtuoso
  // can maintain scroll position without jumping when new items are added.
  const [firstItemIndex, setFirstItemIndex] = useState(0);

  // today is always at index INITIAL_BEFORE in the initial array
  const todayIndex = INITIAL_BEFORE;

  const todayItemRef = useRef<HTMLDivElement | null>(null);

  // After Virtuoso renders today's item, smoothly scroll it to the top of
  // the scroll container using native scrollIntoView — reliable regardless
  // of item heights above today.
  useEffect(() => {
    if (!scrollEl) return;
    const id = setTimeout(() => {
      todayItemRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(id);
  }, [scrollEl]);

  const prependDays = useCallback(() => {
    setDates((prev) => {
      const oldest = prev[0];
      const newDays = Array.from({ length: LOAD_MORE }, (_, i) =>
        addDays(oldest, -(LOAD_MORE - i)),
      );
      return [...newDays, ...prev];
    });
    setFirstItemIndex((fi) => fi - LOAD_MORE);
  }, []);

  const appendDays = useCallback(() => {
    setDates((prev) => {
      const newest = prev[prev.length - 1];
      return [
        ...prev,
        ...Array.from({ length: LOAD_MORE }, (_, i) => addDays(newest, i + 1)),
      ];
    });
  }, []);

  return (
    <div className="h-full w-full">
      <div
        ref={setScrollEl}
        className="h-full overflow-y-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
        }}
      >
        {/* Only mount Virtuoso once scrollEl is available so customScrollParent is never undefined on first render */}
        {scrollEl && (
          <Virtuoso
            customScrollParent={scrollEl}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={todayIndex}
            estimatedItemSize={500}
            data={dates}
            itemContent={(_index, date) => (
              <div
                className="px-2 pt-6"
                ref={isToday(date) ? todayItemRef : undefined}
              >
                <DaySection
                  date={date}
                  butlerName={butlerName}
                  collabToken={collabToken}
                  prefetchedPage={isToday(date) ? todayPage : undefined}
                  blockedCount={isToday(date) ? blockedCount : undefined}
                />
              </div>
            )}
            increaseViewportBy={2000}
            overscan={LOAD_MORE}
            startReached={prependDays}
            endReached={appendDays}
          />
        )}
      </div>
    </div>
  );
}

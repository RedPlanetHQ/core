import React, { useState, useCallback, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { format, addDays, isToday } from "date-fns";
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
}: {
  date: Date;
  butlerName: string;
  collabToken: string;
  prefetchedPage?: PageRecord;
}) {
  const [page, setPage] = React.useState<PageRecord | null>(
    prefetchedPage ?? null,
  );
  const [loading, setLoading] = React.useState(!prefetchedPage);
  const today = isToday(date);

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
    <div className={`mb-8 ${today ? "min-h-[60vh]" : "min-h-[120px]"}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2
          className={`text-2xl font-medium ${
            today ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {format(date, "EEE, MMMM do, yyyy")}
          {today && <span className="text-primary ml-2">•</span>}
        </h2>
      </div>

      {loading ? (
        <div className="bg-muted/30 ml-0 h-4 w-32 animate-pulse rounded" />
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
}: DailyPageProps) {
  const today = useRef(new Date()).current;
  // Callback ref: re-renders when the scroll element mounts, so Virtuoso
  // receives the correct customScrollParent on its very first render.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const [dates, setDates] = useState<Date[]>(() => buildInitialDates(today));

  // today is always at index INITIAL_BEFORE in the initial array
  const todayIndex = INITIAL_BEFORE;

  // Use a ref so the guard doesn't trigger re-renders
  const initialScrollDoneRef = useRef(false);

  const prependDays = useCallback(() => {
    setDates((prev) => {
      const oldest = prev[0];
      const newDays = Array.from({ length: LOAD_MORE }, (_, i) =>
        addDays(oldest, -(LOAD_MORE - i)),
      );
      return [...newDays, ...prev];
    });
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
        {/* Only mount Virtuoso once scrollEl is available so initialTopMostItemIndex
            works correctly and customScrollParent is never undefined on first render */}
        {scrollEl && (
          <Virtuoso
            customScrollParent={scrollEl}
            totalCount={dates.length}
            itemContent={(index) => {
              const date = dates[index];
              return (
                <div className="px-2 pt-6">
                  <DaySection
                    date={date}
                    butlerName={butlerName}
                    collabToken={collabToken}
                    prefetchedPage={isToday(date) ? todayPage : undefined}
                  />
                </div>
              );
            }}
            increaseViewportBy={800}
            overscan={LOAD_MORE}
            initialTopMostItemIndex={todayIndex}
            endReached={appendDays}
            atTopStateChange={(atTop) => {
              if (initialScrollDoneRef.current && atTop) {
                prependDays();
              } else {
                initialScrollDoneRef.current = true;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

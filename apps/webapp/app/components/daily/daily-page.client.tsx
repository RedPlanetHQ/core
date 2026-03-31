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
}: {
  date: Date;
  butlerName: string;
  collabToken: string;
}) {
  const [page, setPage] = React.useState<PageRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const today = isToday(date);

  React.useEffect(() => {
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
      <div className={`mb-3 flex items-center gap-2`}>
        <h2
          className={`text-2xl font-medium ${
            today ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {format(date, "EEE, MMMM do, yyyy")}
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

export function DailyPage({ butlerName, collabToken }: DailyPageProps) {
  const today = useRef(new Date()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  const [dates, setDates] = useState<Date[]>(() => buildInitialDates(today));

  // today is always at index INITIAL_BEFORE in the initial array
  const todayIndex = INITIAL_BEFORE;

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
    <div className="flex h-full w-full flex-col">
      <div
        ref={scrollRef}
        className="h-full grow overflow-y-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
        }}
      >
        <Virtuoso
          customScrollParent={scrollRef.current ?? undefined}
          totalCount={dates.length}
          itemContent={(index) => (
            <div className="px-2 pt-6">
              <DaySection
                date={dates[index]}
                butlerName={butlerName}
                collabToken={collabToken}
              />
            </div>
          )}
          style={{ height: "100%" }}
          overscan={LOAD_MORE}
          initialTopMostItemIndex={todayIndex}
          endReached={appendDays}
          atTopStateChange={(atTop) => {
            if (initialScrollDone && atTop) {
              prependDays();
            } else {
              setInitialScrollDone(true);
            }
          }}
        />
      </div>
    </div>
  );
}

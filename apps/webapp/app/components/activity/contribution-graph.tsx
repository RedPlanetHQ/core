import React, { useMemo } from "react";
import CalendarHeatmap from "react-calendar-heatmap";
import { cn } from "~/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

interface ContributionGraphProps {
  data: Array<{
    date: string;
    count: number;
    status?: string;
  }>;
  className?: string;
}

export function ContributionGraph({ data, className }: ContributionGraphProps) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const [active, setActive] = React.useState<any>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const processedData = useMemo(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1);

    return data.map((item) => ({
      date: item.date,
      count: item.count,
      status: item.status,
    }));
  }, [data]);

  const getClassForValue = (value: any) => {
    if (!value || value.count === 0) {
      return "fill-background dark:fill-background";
    }

    const count = value.count;
    if (count >= 20) return "fill-success";
    if (count >= 15) return "fill-success/85";
    if (count >= 10) return "fill-success/70";
    if (count >= 5) return "fill-success/50";
    return "fill-success/30";
  };

  const getTitleForValue = (value: any) => {
    if (!value || value.count === 0) {
      return `No activity on ${value?.date || "this date"}`;
    }

    const count = value.count;
    const date = new Date(value.date).toLocaleDateString();
    return `${count} ${count === 1 ? "activity" : "activities"} on ${date}`;
  };

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 1);

  // Position helpers: convert client coords to container-local coords
  const getLocalPoint = (e: React.MouseEvent<SVGRectElement, MouseEvent>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX, y: e.clientY };
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex w-full flex-col justify-center", className)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        {anchor && (
          <PopoverAnchor
            // Absolutely position the anchor relative to the container
            style={{
              position: "absolute",
              left: anchor.x,
              top: anchor.y,
              width: 1,
              height: 1,
            }}
          />
        )}
        <PopoverContent
          className="shadow-1 bg-background-3 w-fit p-2"
          side="top"
          align="center"
        >
          {active ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {new Date(active.date).toDateString()}
              </div>
              <div className="text-muted-foreground text-sm">
                {active.count ?? 0} events
              </div>
              {active.meta?.notes && (
                <p className="mt-2 text-sm">{active.meta.notes}</p>
              )}
            </div>
          ) : (
            <div className="text-sm">No data</div>
          )}
        </PopoverContent>
      </Popover>

      <div className="overflow-x-auto rounded-lg">
        <CalendarHeatmap
          startDate={startDate}
          endDate={endDate}
          values={processedData}
          classForValue={getClassForValue}
          titleForValue={getTitleForValue}
          showWeekdayLabels={true}
          showMonthLabels={true}
          gutterSize={2}
          horizontal={true}
          transformDayElement={(element: any, value) => {
            // React clones the <rect>. We add handlers to open the shared popover.
            return React.cloneElement(element, {
              onClick: (e: React.MouseEvent<SVGRectElement>) => {
                setActive(value);
                setAnchor(getLocalPoint(e));
                setOpen(true);
              },
              onMouseEnter: (e: React.MouseEvent<SVGRectElement>) => {
                // If you want hover popovers, uncomment:
                setActive(value);
                setAnchor(getLocalPoint(e));
                setOpen(true);
              },
              onMouseLeave: () => {
                // For hover behavior, you might want a small delay instead of closing immediately.
                setOpen(false);
              },
              style: { cursor: "pointer" },
            });
          }}
        />
      </div>
    </div>
  );
}

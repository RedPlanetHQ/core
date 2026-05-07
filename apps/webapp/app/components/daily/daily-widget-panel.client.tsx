import { DailyWidgetGrid } from "./daily-widget-grid.client";
import type { OverviewCell, WidgetOption } from "~/components/overview/types";

interface Props {
  initialCells: OverviewCell[];
  widgetOptions: WidgetOption[];
  onSave: (cells: OverviewCell[]) => void;
}

export function DailyWidgetPanel({
  initialCells,
  widgetOptions,
  onSave,
}: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <DailyWidgetGrid
        initialCells={initialCells}
        widgetOptions={widgetOptions}
        onSave={onSave}
      />
    </div>
  );
}

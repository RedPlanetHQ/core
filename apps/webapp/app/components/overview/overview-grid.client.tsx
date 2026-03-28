import { forwardRef, useImperativeHandle, useState } from "react";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { OverviewCell, WidgetOption } from "./types";
import { WidgetPicker } from "./widget-picker";
import { WidgetCell } from "./widget-cell.client";
import { Button } from "~/components/ui";
import { GripVertical, LayoutGrid, Plus, X } from "lucide-react";

interface Props {
  initialCells: OverviewCell[];
  widgetOptions: WidgetOption[];
  onSave: (cells: OverviewCell[]) => void;
  widgetPat: string | null;
  baseUrl: string;
}

export interface OverviewGridHandle {
  addCell: () => void;
}

export const OverviewGrid = forwardRef<OverviewGridHandle, Props>(function OverviewGrid({
  initialCells,
  widgetOptions,
  onSave,
  widgetPat,
  baseUrl,
}, ref) {
  const [cells, setCells] = useState<OverviewCell[]>(initialCells);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const layout: Layout[] = cells.map((cell) => ({
    i: cell.id,
    x: cell.x,
    y: cell.y,
    w: cell.w,
    h: cell.h,
    minW: 1,
    maxW: 3,
    minH: 1,
  }));

  const handleLayoutChange = (_layout: Layout[]) => {
    const updated = cells.map((cell) => {
      const item = _layout.find((l) => l.i === cell.id);
      if (!item) return cell;
      return { ...cell, x: item.x, y: item.y, w: item.w, h: item.h };
    });
    setCells(updated);
    onSave(updated);
  };

  useImperativeHandle(ref, () => ({ addCell: handleAddCell }));

  const handleAddCell = () => {
    const newCell: OverviewCell = {
      id: crypto.randomUUID(),
      x: 0,
      y: Infinity,
      w: 1,
      h: 2,
      widgetSlug: null,
      integrationSlug: null,
      integrationAccountId: null,
    };
    const updated = [...cells, newCell];
    setCells(updated);
    onSave(updated);
  };

  const handleRemoveCell = (id: string) => {
    const updated = cells.filter((c) => c.id !== id);
    setCells(updated);
    onSave(updated);
  };

  const handleOpenPicker = (cellId: string) => {
    setSelectedCellId(cellId);
    setPickerOpen(true);
  };

  const handlePickWidget = (option: WidgetOption) => {
    if (!selectedCellId) return;
    const updated = cells.map((c) =>
      c.id === selectedCellId
        ? {
            ...c,
            widgetSlug: option.widgetSlug,
            integrationSlug: option.integrationSlug,
            integrationAccountId: option.integrationAccountId,
          }
        : c,
    );
    setCells(updated);
    onSave(updated);
    setPickerOpen(false);
    setSelectedCellId(null);
  };

  if (cells.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="bg-grayAlpha-100 flex h-16 w-16 items-center justify-center rounded-full">
          <LayoutGrid size={28} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-md">Your overview is empty</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add widgets from your connected integrations.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" onClick={handleAddCell}>
          <Plus size={16} />
          Add widget
        </Button>
      </div>
    );
  }

  return (
    <div className="p-2">
      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            width={width}
            layout={layout}
            cols={3}
            rowHeight={160}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".cell-drag-handle"
            draggableCancel=".cell-content"
            margin={[12, 12]}
            containerPadding={[0, 0]}
            resizeHandles={["e", "se", "s"]}
          >
            {cells.map((cell) => {
              const option =
                cell.widgetSlug && cell.integrationAccountId
                  ? widgetOptions.find(
                      (o) =>
                        o.widgetSlug === cell.widgetSlug &&
                        o.integrationAccountId === cell.integrationAccountId,
                    )
                  : undefined;

              return (
                <div
                  key={cell.id}
                  className="bg-background flex flex-col overflow-hidden rounded-lg border border-gray-200"
                >
                  <div className="cell-drag-handle flex cursor-grab select-none items-center justify-between border-b border-gray-200 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <GripVertical
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                      <span className="text-muted-foreground truncate text-xs">
                        {option
                          ? `${option.integrationName} · ${option.widgetName}`
                          : "Empty"}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveCell(cell.id);
                      }}
                      className="text-muted-foreground hover:text-foreground ml-2 shrink-0 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                  <div
                    className="cell-content flex flex-1 overflow-hidden"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {option && widgetPat ? (
                      <WidgetCell
                        widgetSlug={option.widgetSlug}
                        frontendUrl={option.frontendUrl}
                        integrationAccountId={option.integrationAccountId}
                        integrationSlug={option.integrationSlug}
                        integrationName={option.integrationName}
                        pat={widgetPat}
                        baseUrl={baseUrl}
                      />
                    ) : (
                      <button
                        onClick={() => handleOpenPicker(cell.id)}
                        className="text-muted-foreground hover:text-foreground flex h-full w-full flex-col items-center justify-center gap-2 transition-colors"
                      >
                        <div className="rounded-full border-2 border-dashed border-current p-3">
                          <Plus size={18} />
                        </div>
                        <span className="text-xs">Add widget</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      <WidgetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        widgetOptions={widgetOptions}
        onSelect={handlePickWidget}
      />
    </div>
  );
});

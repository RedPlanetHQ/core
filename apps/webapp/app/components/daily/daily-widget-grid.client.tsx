import { useRef, useState } from "react";
import type { OverviewCell, WidgetOption } from "~/components/overview/types";
import { WidgetCell } from "~/components/overview/widget-cell.client";
import { Button } from "~/components/ui";
import {
  AlertCircle,
  GripVertical,
  LayoutGrid,
  Plug,
  Plus,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { NeedsAttentionWidget } from "./needs-attention-widget.client";

interface NativeWidget {
  widgetSlug: string;
  widgetName: string;
  widgetDescription: string;
}

const NATIVE_WIDGETS: NativeWidget[] = [
  {
    widgetSlug: "needs-attention",
    widgetName: "Needs Attention",
    widgetDescription: "Waiting tasks that need your attention",
  },
];

const NATIVE_WIDGET_MAP: Record<string, NativeWidget> = Object.fromEntries(
  NATIVE_WIDGETS.map((w) => [w.widgetSlug, w]),
);

const DEFAULT_CELLS: OverviewCell[] = [
  {
    id: "default-needs-attention",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    widgetSlug: "needs-attention",
    integrationSlug: null,
    integrationAccountId: null,
    config: null,
  },
];

interface Props {
  initialCells: OverviewCell[];
  widgetOptions: WidgetOption[];
  onSave: (cells: OverviewCell[]) => void;
  widgetPat: string | null;
  baseUrl: string;
}

type PickerSelection = WidgetOption | NativeWidget;

function DailyWidgetPicker({
  open,
  onOpenChange,
  widgetOptions,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  widgetOptions: WidgetOption[];
  onSelect: (option: PickerSelection) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {/* Native built-in widgets */}
          {NATIVE_WIDGETS.map((nw) => (
            <button
              key={nw.widgetSlug}
              onClick={() => onSelect(nw)}
              className="hover:bg-grayAlpha-100 flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors"
            >
              <div className="bg-grayAlpha-100 flex h-7 w-7 items-center justify-center rounded">
                <AlertCircle size={14} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{nw.widgetName}</p>
                <p className="text-muted-foreground text-xs">
                  {nw.widgetDescription}
                </p>
              </div>
            </button>
          ))}

          {/* Integration widgets */}
          {widgetOptions.length > 0 && (
            <>
              {NATIVE_WIDGETS.length > 0 && (
                <div className="border-t border-gray-100 pt-1 dark:border-gray-800" />
              )}
              {widgetOptions.map((option) => (
                <button
                  key={`${option.integrationAccountId}-${option.widgetSlug}`}
                  onClick={() => onSelect(option)}
                  className="hover:bg-grayAlpha-100 flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors"
                >
                  {option.integrationIcon ? (
                    <img
                      src={option.integrationIcon}
                      alt=""
                      className="h-7 w-7 rounded object-contain"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded text-xs font-medium uppercase">
                      {option.integrationName.slice(0, 2)}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium">{option.widgetName}</p>
                    <p className="text-muted-foreground text-xs">
                      {option.integrationName} · {option.widgetDescription}
                    </p>
                  </div>
                </button>
              ))}
            </>
          )}

          {NATIVE_WIDGETS.length === 0 && widgetOptions.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <Plug size={32} className="text-muted-foreground" />
              <p className="text-base">No widgets available.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DailyWidgetGrid({
  initialCells,
  widgetOptions,
  onSave,
  widgetPat,
  baseUrl,
}: Props) {
  const [cells, setCells] = useState<OverviewCell[]>(
    initialCells.length > 0 ? initialCells : DEFAULT_CELLS,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const handleAddCell = () => {
    const newCell: OverviewCell = {
      id: crypto.randomUUID(),
      x: 0,
      y: cells.length,
      w: 1,
      h: 1,
      widgetSlug: null,
      integrationSlug: null,
      integrationAccountId: null,
      config: null,
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

  const handlePickWidget = (option: PickerSelection) => {
    if (!selectedCellId) return;
    const isNative = !("integrationAccountId" in option);
    const updated = cells.map((c) =>
      c.id === selectedCellId
        ? {
            ...c,
            widgetSlug: option.widgetSlug,
            integrationSlug: isNative
              ? null
              : (option as WidgetOption).integrationSlug,
            integrationAccountId: isNative
              ? null
              : (option as WidgetOption).integrationAccountId,
          }
        : c,
    );
    setCells(updated);
    onSave(updated);
    setPickerOpen(false);
    setSelectedCellId(null);
  };

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const reordered = [...cells];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(index, 0, moved);
    dragIndex.current = index;
    setCells(reordered);
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    onSave(cells);
  };

  if (cells.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="bg-grayAlpha-100 flex h-16 w-16 items-center justify-center rounded-full">
          <LayoutGrid size={28} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-md">No widgets yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add widgets to customize your daily view.
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
    <div className="flex w-full flex-col gap-3 p-3">
      {cells.map((cell, index) => {
        const isNative = cell.widgetSlug
          ? cell.widgetSlug in NATIVE_WIDGET_MAP
          : false;
        const nativeMeta = isNative
          ? NATIVE_WIDGET_MAP[cell.widgetSlug!]
          : null;
        const integrationOption =
          !isNative && cell.widgetSlug && cell.integrationAccountId
            ? widgetOptions.find(
                (o) =>
                  o.widgetSlug === cell.widgetSlug &&
                  o.integrationAccountId === cell.integrationAccountId,
              )
            : undefined;

        const label = nativeMeta
          ? nativeMeta.widgetName
          : integrationOption
            ? `${integrationOption.integrationName} · ${integrationOption.widgetName}`
            : "Empty";

        return (
          <div
            key={cell.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className="border-border flex w-full flex-col overflow-hidden rounded-lg border"
          >
            <div className="flex shrink-0 cursor-grab select-none items-center justify-between border-b border-gray-200 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <GripVertical
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span className="text-muted-foreground truncate text-xs">
                  {label}
                </span>
              </div>
              <button
                onClick={() => handleRemoveCell(cell.id)}
                className="text-muted-foreground hover:text-foreground ml-2 shrink-0 transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            <div className="w-full">
              {isNative && cell.widgetSlug === "needs-attention" ? (
                <NeedsAttentionWidget />
              ) : integrationOption && widgetPat ? (
                <WidgetCell
                  widgetSlug={integrationOption.widgetSlug}
                  frontendUrl={integrationOption.frontendUrl}
                  integrationAccountId={integrationOption.integrationAccountId}
                  integrationSlug={integrationOption.integrationSlug}
                  integrationName={integrationOption.integrationName}
                  pat={widgetPat}
                  baseUrl={baseUrl}
                />
              ) : (
                <Button
                  onClick={() => handleOpenPicker(cell.id)}
                  className="w-full"
                  size="xl"
                  variant="outline"
                >
                  <Plus size={18} />

                  <span className="text-xs">Add widget</span>
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <button
        onClick={handleAddCell}
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 p-3 text-sm transition-colors hover:border-gray-300 dark:border-gray-700"
      >
        <Plus size={14} />
        Add widget
      </button>

      <DailyWidgetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        widgetOptions={widgetOptions}
        onSelect={handlePickWidget}
      />
    </div>
  );
}

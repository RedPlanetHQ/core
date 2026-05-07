import { useRef, useState } from "react";
import type { OverviewCell, WidgetOption } from "~/components/overview/types";
import { CoreWidgetContent } from "~/components/widgets/CoreWidgetView";
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
import { getIcon, type IconType } from "~/components/icon-utils";

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
    widgetId: null,
  },
];

interface Props {
  initialCells: OverviewCell[];
  /** Picker source — sourced from the unified Widget table by the loader. */
  widgetOptions: WidgetOption[];
  onSave: (cells: OverviewCell[]) => void;
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

          {/* Widgets sourced from the Widget table */}
          {widgetOptions.length > 0 && (
            <>
              {NATIVE_WIDGETS.length > 0 && (
                <div className="border-t border-gray-100 pt-1 dark:border-gray-800" />
              )}
              {widgetOptions.map((option) => {
                const Icon = option.integrationIcon
                  ? getIcon(option.integrationIcon as IconType)
                  : null;
                const isDeclarative = !option.integrationSlug;
                const subtitle =
                  option.integrationName && option.widgetDescription
                    ? `${option.integrationName} · ${option.widgetDescription}`
                    : option.integrationName || option.widgetDescription || "";
                return (
                  <button
                    key={option.widgetId ?? `${option.integrationAccountId}-${option.widgetSlug}`}
                    onClick={() => onSelect(option)}
                    className="hover:bg-grayAlpha-100 flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors"
                  >
                    {Icon ? (
                      <div className="bg-background-2 flex h-7 w-7 items-center justify-center rounded">
                        <Icon size={18} />
                      </div>
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded text-xs font-medium uppercase">
                        {(isDeclarative ? option.widgetName : option.integrationName).slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{option.widgetName}</p>
                      {subtitle && (
                        <p className="text-muted-foreground text-xs">
                          {subtitle}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
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

// ─── Config form (shown when a picked widget has required unfilled fields) ─

function ConfigForm({
  open,
  schema,
  initialValues,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  schema: WidgetOption["configSchema"];
  initialValues: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      schema.map((f) => [f.key, initialValues[f.key] ?? f.default ?? ""]),
    ),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configure widget</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {schema.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className="text-xs font-medium">
                {field.label}
                {field.required && (
                  <span className="ml-0.5 text-destructive">*</span>
                )}
              </label>
              {field.type === "select" ? (
                <select
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  required={field.required}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select…</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** True if the schema has at least one required field with no value (and no default). */
function needsConfigInput(
  schema: WidgetOption["configSchema"],
  values: Record<string, string> | null,
): boolean {
  if (!schema || schema.length === 0) return false;
  for (const field of schema) {
    if (!field.required) continue;
    const cur = values?.[field.key];
    if (cur && cur.length > 0) continue;
    if (field.default && field.default.length > 0) continue;
    return true;
  }
  return false;
}

export function DailyWidgetGrid({
  initialCells,
  widgetOptions,
  onSave,
}: Props) {
  const [cells, setCells] = useState<OverviewCell[]>(
    initialCells.length > 0 ? initialCells : DEFAULT_CELLS,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [configFormState, setConfigFormState] = useState<{
    cellId: string;
    option: WidgetOption;
  } | null>(null);
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
      widgetId: null,
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

  /** Apply a final selection (widget + config) to the cell and save. */
  const applySelection = (
    cellId: string,
    selection: PickerSelection,
    config: Record<string, string> | null,
  ) => {
    const isNative = !("integrationAccountId" in selection);
    const widgetOption = isNative ? null : (selection as WidgetOption);
    const updated = cells.map((c) =>
      c.id === cellId
        ? {
            ...c,
            widgetSlug: selection.widgetSlug,
            // Empty integration fields = declarative widget; store as null.
            integrationSlug: widgetOption?.integrationSlug || null,
            integrationAccountId: widgetOption?.integrationAccountId || null,
            widgetId: widgetOption?.widgetId ?? null,
            config: isNative ? null : config,
          }
        : c,
    );
    setCells(updated);
    onSave(updated);
  };

  const handlePickWidget = (option: PickerSelection) => {
    if (!selectedCellId) return;
    setPickerOpen(false);

    const isNative = !("integrationAccountId" in option);
    if (isNative) {
      applySelection(selectedCellId, option, null);
      setSelectedCellId(null);
      return;
    }

    const widgetOption = option as WidgetOption;
    if (needsConfigInput(widgetOption.configSchema, null)) {
      // Defer save — show config form first.
      setConfigFormState({ cellId: selectedCellId, option: widgetOption });
      return;
    }

    // Auto-fill defaults; no form needed.
    const defaults: Record<string, string> = {};
    for (const f of widgetOption.configSchema ?? []) {
      if (f.default) defaults[f.key] = f.default;
    }
    applySelection(
      selectedCellId,
      widgetOption,
      Object.keys(defaults).length > 0 ? defaults : null,
    );
    setSelectedCellId(null);
  };

  const handleConfigSubmit = (values: Record<string, string>) => {
    if (!configFormState) return;
    applySelection(configFormState.cellId, configFormState.option, values);
    setConfigFormState(null);
    setSelectedCellId(null);
  };

  const handleConfigCancel = () => {
    setConfigFormState(null);
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

        // Resolve a widgetRef for the new render path: prefer cell.widgetId,
        // else fall back to a lookup against widgetOptions by (slug, account).
        let widgetRef: string | null = null;
        let displayLabel: string | null = null;
        if (!isNative) {
          if (cell.widgetId) {
            widgetRef = cell.widgetId;
            const opt = widgetOptions.find((o) => o.widgetId === cell.widgetId);
            displayLabel = opt
              ? `${opt.integrationName} · ${opt.widgetName}`
              : null;
          } else if (cell.widgetSlug && cell.integrationAccountId) {
            const opt = widgetOptions.find(
              (o) =>
                o.widgetSlug === cell.widgetSlug &&
                o.integrationAccountId === cell.integrationAccountId,
            );
            if (opt) {
              widgetRef = opt.widgetId ?? null;
              displayLabel = `${opt.integrationName} · ${opt.widgetName}`;
            }
          }
        }

        const label = nativeMeta
          ? nativeMeta.widgetName
          : (displayLabel ?? "Empty");

        return (
          <div
            key={cell.id}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className="border-border flex w-full flex-col overflow-hidden rounded-lg border"
          >
            <div
              draggable
              onDragStart={() => handleDragStart(index)}
              className="flex shrink-0 cursor-grab select-none items-center justify-between border-b border-gray-200 px-3 py-2"
            >
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
              ) : widgetRef ? (
                <CoreWidgetContent
                  widgetRef={widgetRef}
                  configOverride={cell.config ?? undefined}
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

      {configFormState && (
        <ConfigForm
          open
          schema={configFormState.option.configSchema}
          initialValues={{}}
          onSubmit={handleConfigSubmit}
          onCancel={handleConfigCancel}
        />
      )}
    </div>
  );
}

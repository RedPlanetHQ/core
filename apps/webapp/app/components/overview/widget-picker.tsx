import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { WidgetOption } from "./types";
import { Plug } from "lucide-react";
import { getIcon, type IconType } from "~/components/icon-utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetOptions: WidgetOption[];
  onSelect: (option: WidgetOption) => void;
}

export function WidgetPicker({
  open,
  onOpenChange,
  widgetOptions,
  onSelect,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>

        {widgetOptions.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Plug size={32} className="text-muted-foreground" />
            <p className="text-base">No widgets available.</p>
            <p className="text-muted-foreground text-sm">
              Connect integrations that provide widgets to add them here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {widgetOptions.map((option) => {
              const Icon = option.integrationIcon
                ? getIcon(option.integrationIcon as IconType)
                : null;
              return (
                <button
                  key={`${option.integrationAccountId}-${option.widgetSlug}`}
                  onClick={() => onSelect(option)}
                  className="hover:bg-grayAlpha-100 flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors"
                >
                  {Icon ? (
                    <div className="bg-background-2 flex h-7 w-7 items-center justify-center rounded">
                      <Icon size={18} />
                    </div>
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
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

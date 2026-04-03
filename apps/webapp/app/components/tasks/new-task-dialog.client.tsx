import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TaskInlineForm } from "~/components/tasks/task-inline-form.client";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, description: string, status: string) => void;
  isSubmitting: boolean;
  initialTitle?: string;
  initialDescription?: string;
  mode?: "create" | "edit";
}

export function NewTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  initialTitle = "",
  initialDescription = "",
  mode = "create",
}: NewTaskDialogProps) {
  const handleOpenChange = (val: boolean) => {
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="px-4 pb-0 pt-4">
          <DialogTitle className="text-muted-foreground text-xs font-normal">
            {mode === "edit" ? "Edit task" : "New task"}
          </DialogTitle>
        </DialogHeader>
        <div className="p-2">
          {open && (
            <TaskInlineForm
              showStatus
              initialTitle={initialTitle}
              initialDescription={initialDescription}
              mode={mode}
              isSubmitting={isSubmitting}
              onSubmit={(title, description, status) => {
                onSubmit(title, description, status);
              }}
              onCancel={() => handleOpenChange(false)}
              className="border-none p-2 pt-0 shadow-none"
              titleClassName="text-lg"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

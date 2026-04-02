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
  onSubmit: (title: string, description: string) => void;
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
      <DialogContent className="gap-0 p-0 sm:max-w-md overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-xs font-normal text-muted-foreground">
            {mode === "edit" ? "Edit task" : "New task"}
          </DialogTitle>
        </DialogHeader>
        <div className="p-2">
          {open && (
            <TaskInlineForm
              showStatus={false}
              initialTitle={initialTitle}
              initialDescription={initialDescription}
              mode={mode}
              isSubmitting={isSubmitting}
              onSubmit={(title, description) => {
                onSubmit(title, description);
              }}
              onCancel={() => handleOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useFetcher } from "@remix-run/react";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function SourceFolderMenu({
  source,
  onDeleted,
}: {
  source: string;
  onDeleted: () => void;
}) {
  const deleteFetcher = useFetcher();
  const [alertOpen, setAlertOpen] = useState(false);

  function handleConfirm() {
    deleteFetcher.submit(
      { source },
      {
        method: "DELETE",
        action: "/api/v1/conversations/delete-source",
        encType: "application/json",
      },
    );
    onDeleted();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 w-5 shrink-0 rounded p-0 opacity-0 transition-opacity group-hover/folder:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Ellipsis size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[160px]">
          <DropdownMenuItem
            className="rounded"
            onClick={(e) => {
              e.stopPropagation();
              setAlertOpen(true);
            }}
          >
            Delete all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all conversations in this folder.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

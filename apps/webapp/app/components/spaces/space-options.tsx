import { EllipsisVertical, RefreshCcw, Trash, Edit } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
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
import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { EditSpaceDialog } from "./edit-space-dialog.client";

interface SpaceOptionsProps {
  id: string;
  name?: string;
  description?: string | null;
}

export const SpaceOptions = ({ id, name, description }: SpaceOptionsProps) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetSpace, setResetSpace] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const deleteFetcher = useFetcher();
  const resetFetcher = useFetcher();

  const handleDelete = () => {
    deleteFetcher.submit({
      method: "DELETE",
      action: `/api/v1/space/${id}`,
      encType: "application/json",
    });
    setDeleteDialogOpen(false);
  };

  const handleReset = () => {
    resetFetcher.submit({
      method: "POST",
      action: `/api/v1/space/${id}/reset`,
      encType: "application/json",
    });
    setResetSpace(false);
  };

  const handleEditSuccess = () => {
    // Revalidate the page data to show updated space info
    // revalidator.revalidate();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="mr-0.5 h-8 shrink items-center justify-between gap-2 px-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <EllipsisVertical size={16} />
            </div>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
            <Button variant="link" size="sm" className="gap-2 rounded">
              <Edit size={15} /> Edit
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setResetSpace(true)}>
            <Button variant="link" size="sm" className="gap-2 rounded">
              <RefreshCcw size={15} /> Reset
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)}>
            <Button variant="link" size="sm" className="gap-2 rounded">
              <Trash size={15} /> Delete
            </Button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete space</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this space? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetSpace} onOpenChange={setResetSpace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete space</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset this space? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Space Dialog */}
      <EditSpaceDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        spaceId={id}
        initialName={name || ""}
        initialDescription={description}
        onSuccess={handleEditSuccess}
      />
    </>
  );
};

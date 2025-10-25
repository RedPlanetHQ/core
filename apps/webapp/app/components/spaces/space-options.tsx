import { EllipsisVertical, RefreshCcw, Trash, Edit, Copy } from "lucide-react";
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
import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { EditSpaceDialog } from "./edit-space-dialog.client";
import { toast } from "~/hooks/use-toast";

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
  const navigate = useNavigate();

  const handleDelete = () => {
    deleteFetcher.submit(null, {
      method: "DELETE",
      action: `/api/v1/spaces/${id}`,
      encType: "application/json",
    });

    setDeleteDialogOpen(false);
  };

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data) {
      navigate("/home/space");
    }
  }, [deleteFetcher.state, deleteFetcher.data, navigate]);

  const handleReset = () => {
    resetFetcher.submit(null, {
      method: "POST",
      action: `/api/v1/spaces/${id}/reset`,
      encType: "application/json",
    });
    setResetSpace(false);
  };

  const handleEditSuccess = () => {
    // Revalidate the page data to show updated space info
    // revalidator.revalidate();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast({
        title: "Copied",
        description: "Space ID copied to clipboard",
      });
    } catch (err) {
      console.error("Failed to copy:", err);
      toast({
        title: "Error",
        description: "Failed to copy ID",
        variant: "destructive",
      });
    }
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
          <DropdownMenuItem onClick={handleCopy}>
            <Button variant="link" size="sm" className="gap-2 rounded">
              <Copy size={15} /> Copy Id
            </Button>
          </DropdownMenuItem>
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
              Are you sure you want to reset this space? This is create
              categorise all facts again in this space
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

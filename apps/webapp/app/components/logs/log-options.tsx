import { EllipsisVertical, Trash } from "lucide-react";
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
import { useState, useEffect } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";

interface LogOptionsProps {
  id: string;
}

export const LogOptions = ({ id }: LogOptionsProps) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const navigate = useNavigate();

  const handleDelete = () => {
    deleteFetcher.submit(
      { id },
      {
        method: "DELETE",
        action: "/api/v1/ingestion_queue/delete",
        encType: "application/json",
      },
    );
    setDeleteDialogOpen(false);
  };

  useEffect(() => {
    console.log(deleteFetcher.state, deleteFetcher.data);
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.success) {
      navigate(`/home/inbox`);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          asChild
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
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
          <DropdownMenuItem
            onClick={(e) => {
              setDeleteDialogOpen(true);
            }}
          >
            <Button variant="link" size="sm" className="gap-2 rounded">
              <Trash size={15} /> Delete
            </Button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Episode</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this episode? This action cannot
              be undone.
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
    </>
  );
};

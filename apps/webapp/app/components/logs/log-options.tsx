import { Trash, Copy, RotateCw } from "lucide-react";
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
import { toast } from "~/hooks/use-toast";

interface LogOptionsProps {
  id: string;
  status?: string;
  sessionId?: string | null;
}

export const LogOptions = ({ id, status, sessionId }: LogOptionsProps) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const retryFetcher = useFetcher<{ success: boolean }>();
  const navigate = useNavigate();

  const handleDelete = (deleteSession: boolean = false) => {
    const url = deleteSession
      ? `/api/v1/logs/${id}?deleteSession=true`
      : `/api/v1/logs/${id}`;

    deleteFetcher.submit(null, {
      method: "DELETE",
      action: url,
    });
    setDeleteDialogOpen(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast({
        title: "Copied",
        description: "Episode ID copied to clipboard",
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

  const handleRetry = () => {
    retryFetcher.submit(
      {},
      {
        method: "POST",
        action: `/api/v1/logs/${id}/retry`,
      },
    );
  };

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.success) {
      navigate(`/home/episodes`);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  useEffect(() => {
    if (retryFetcher.state === "idle" && retryFetcher.data?.success) {
      toast({
        title: "Success",
        description: "Episode retry initiated",
      });
      // Reload the page to reflect the new status
      window.location.reload();
    }
  }, [retryFetcher.state, retryFetcher.data]);

  return (
    <>
      <div className="flex items-center gap-2">
        {status === "FAILED" && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-2 rounded"
            onClick={handleRetry}
            disabled={retryFetcher.state !== "idle"}
          >
            <RotateCw size={15} /> Retry
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="gap-2 rounded"
          onClick={handleCopy}
        >
          <Copy size={15} /> Copy Id
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="gap-2 rounded"
          onClick={(e) => {
            setDeleteDialogOpen(true);
          }}
        >
          <Trash size={15} /> Delete
        </Button>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sessionId ? "Delete Session" : "Delete Episode"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sessionId ? (
                <>
                  This log is part of a conversation session. Do you want to
                  delete:
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Only this episode, or</li>
                    <li>The entire conversation session (all episodes)?</li>
                  </ul>
                  <p className="mt-2 font-semibold">
                    This action cannot be undone.
                  </p>
                </>
              ) : (
                "Are you sure you want to delete this episode? This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {sessionId ? (
              <>
                <AlertDialogAction
                  onClick={() => handleDelete(false)}
                  variant="outline"
                >
                  Delete This Episode Only
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => handleDelete(true)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete Entire Session
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={() => handleDelete(false)}>
                Continue
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

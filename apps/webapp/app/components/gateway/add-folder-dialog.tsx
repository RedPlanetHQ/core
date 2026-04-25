import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gatewayId: string;
  /** Container-based gateway. Shows the GitHub URL clone option (which lands
   *  in `/app`) and hides local-path entry — Docker filesystem paths aren't
   *  user-meaningful. Native gateways get only the local-path option. */
  isDocker?: boolean;
  onAdded?: () => void;
}

type Mode = "local" | "git";

export function AddFolderDialog({
  open,
  onOpenChange,
  gatewayId,
  isDocker,
  onAdded,
}: Props) {
  const [mode, setMode] = useState<Mode>(isDocker ? "git" : "local");
  const showLocal = !isDocker;
  const showGit = !!isDocker;
  const showTabs = showLocal && showGit;

  const [path, setPath] = useState("");
  const [name, setName] = useState("");

  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode(isDocker ? "git" : "local");
    setPath("");
    setName("");
    setUrl("");
    setBranch("");
    setError(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        mode === "local"
          ? { mode, path: path.trim(), name: name.trim() || undefined }
          : {
              mode,
              url: url.trim(),
              name: name.trim() || undefined,
              branch: branch.trim() || undefined,
            };
      const res = await fetch(`/api/v1/gateways/${gatewayId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      onAdded?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    (mode === "local" ? path.trim().length > 0 : url.trim().length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add folder</DialogTitle>
        </DialogHeader>

        {showTabs ? (
          <div className="bg-grayAlpha-100/50 flex gap-1 rounded p-1">
            <button
              type="button"
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-sm",
                mode === "local"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground",
              )}
              onClick={() => setMode("local")}
            >
              Local path
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-sm",
                mode === "git"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground",
              )}
              onClick={() => setMode("git")}
            >
              GitHub URL
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 py-2">
          {mode === "local" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  Absolute path on the gateway
                </label>
                <Input
                  placeholder="/Users/you/code/my-project"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  placeholder="defaults to last segment of path"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Repository URL</label>
                <Input
                  placeholder="https://github.com/owner/repo"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="url"
                  className="font-mono text-sm"
                />
                <p className="text-muted-foreground text-xs">
                  Cloned into the gateway's workspace dir. Private repos use the
                  gateway's <code>GITHUB_TOKEN</code> env var.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  Branch{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  Folder name{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  placeholder="defaults to repo name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </>
          )}

          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>

        <DialogFooter className="border-none p-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {mode === "git" ? "Cloning…" : "Adding…"}
              </>
            ) : (
              "Add folder"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

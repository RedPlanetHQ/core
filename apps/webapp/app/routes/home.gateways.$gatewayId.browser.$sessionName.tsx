import { type MetaFunction } from "@remix-run/node";
import { useNavigate, useOutletContext, useParams } from "@remix-run/react";
import { Globe, Loader2, Play, Trash2 } from "lucide-react";
import { useState } from "react";

export const meta: MetaFunction = ({ matches, params }) => {
  const sessionName = params.sessionName;
  const gatewayMatch = matches.find(
    (m) => m.id === "routes/home.gateways.$gatewayId",
  );
  const gatewayName = (
    gatewayMatch?.data as { gateway?: { name?: string } } | undefined
  )?.gateway?.name;
  if (sessionName && gatewayName) {
    return [{ title: `${sessionName} · ${gatewayName} | Gateways` }];
  }
  if (sessionName) return [{ title: `${sessionName} | Browser` }];
  return [{ title: "Browser | Gateways" }];
};
import { CdpViewer, buildCdpWsUrl } from "~/components/browser/cdp-viewer";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { GatewayBrowserOutletContext } from "./home.gateways.$gatewayId.browser";

/**
 * Per-session view. Renders the live CDP screencast when the session is
 * running on the gateway, plus a header strip that lets the user delete the
 * session alias.
 */
export default function GatewayBrowserSession() {
  const ctx = useOutletContext<GatewayBrowserOutletContext>();
  const { sessionName } = useParams<{ sessionName: string }>();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  if (!sessionName) return null;

  const session = ctx.sessions?.find((s) => s.name === sessionName) ?? null;

  // Sessions list is still loading — don't flash the "missing" state.
  if (ctx.sessions === null) {
    return (
      <div className="bg-background-2 flex h-full w-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin opacity-50" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bg-background-2 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 px-8 text-center text-sm">
        <Globe className="h-8 w-8" />
        <p>Session "{sessionName}" no longer exists on this gateway.</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate(`/home/gateways/${ctx.gatewayId}/browser`)}
        >
          Back to sessions
        </Button>
      </div>
    );
  }

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/v1/gateways/${ctx.gatewayId}/browser/sessions/${encodeURIComponent(
          sessionName,
        )}`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `delete failed (${res.status})`);
      }
      setConfirmOpen(false);
      ctx.refresh();
      navigate(`/home/gateways/${ctx.gatewayId}/browser`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch(
        `/api/v1/gateways/${ctx.gatewayId}/browser/launch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionName }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new Error(body.error ?? `launch failed (${res.status})`);
      ctx.refresh();
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  const sessionLabel = (
    <>
      <Globe size={12} className="text-muted-foreground shrink-0" />
      <span className="truncate font-medium">{session.name}</span>
      <span className="text-muted-foreground hidden truncate md:inline">
        · {session.profile}
      </span>
    </>
  );

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive h-7 gap-1.5"
      onClick={() => setConfirmOpen(true)}
    >
      <Trash2 size={12} />
      <span className="hidden md:inline">Delete</span>
    </Button>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {session.live ? (
        <CdpViewer
          key={`${ctx.gatewayId}:${session.name}`}
          wsUrl={buildCdpWsUrl(ctx.gatewayId, session.name)}
          leadingNode={sessionLabel}
          actionsNode={deleteButton}
        />
      ) : (
        <>
          <div className="bg-background flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5 text-xs">
            <div className="flex min-w-0 items-center gap-2">{sessionLabel}</div>
            {deleteButton}
          </div>
          <div className="bg-background-2 text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-sm">
            <Globe className="h-8 w-8" />
            <p>Session isn't running yet.</p>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={handleLaunch}
              disabled={launching}
            >
              {launching ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Launch
            </Button>
            {launchError ? (
              <p className="text-destructive text-xs">{launchError}</p>
            ) : null}
          </div>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session "{session.name}"?</DialogTitle>
            <DialogDescription>
              The session alias will be removed from the gateway config. If
              it's running, Chromium will be closed. Profile data on disk is
              preserved.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-destructive text-xs">{deleteError}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

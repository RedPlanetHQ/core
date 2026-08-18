import { useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { XtermPane } from "~/components/gateway/xterm-pane";
import { requestGatewayXtermWsUrl } from "~/lib/xterm-ws.client";
import {
  useGateway,
  useGatewayShell,
} from "~/components/gateway/gateway-provider";

/**
 * The shell session is owned by `<GatewayShellProvider>` at the layout
 * level so the PageHeader's "New shell" button and this route's xterm pane
 * stay in sync. Persistence across route changes (e.g. nav to /home/tasks
 * and back) comes from the gateway's `ptyManager`: the PTY stays alive
 * while the gateway process runs, and `attach()` replays its 256 KB
 * scrollback on every WS reconnect (see `coding_xterm_session.ts`).
 *
 * The WS URL is fetched via /xterm-ticket so capable gateways get a direct
 * browser↔gateway connection; older/http gateways transparently fall back
 * to the webapp proxy path.
 */
export default function GatewayTerminalTab() {
  const ctx = useGateway();
  const { sessionId, loading, error, openShell } = useGatewayShell();

  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setWsUrl(null);
      setWsError(null);
      return;
    }
    let cancelled = false;
    setWsUrl(null);
    setWsError(null);
    requestGatewayXtermWsUrl(ctx.id, sessionId)
      .then((url) => {
        if (!cancelled) setWsUrl(url);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setWsError(
          err instanceof Error ? err.message : "Failed to open terminal",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.id, sessionId]);

  if (loading && !sessionId) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting to shell on the gateway…
      </div>
    );
  }

  if (error || wsError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive max-w-md text-center">
          {error ?? wsError}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={() => openShell(false)}
        >
          <RefreshCcw size={12} />
          Try again
        </Button>
      </div>
    );
  }

  if (!sessionId || !wsUrl) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening terminal…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-1 overflow-hidden">
      <XtermPane
        key={sessionId}
        wsUrl={wsUrl}
        endedAction={{
          label: "Start new shell",
          onClick: () => openShell(true),
        }}
      />
    </div>
  );
}

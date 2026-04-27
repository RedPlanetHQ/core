import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  XtermPane,
  buildGatewayXtermUrl,
} from "~/components/gateway/xterm-pane";
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
 */
export default function GatewayTerminalTab() {
  const ctx = useGateway();
  const { sessionId, loading, error, openShell } = useGatewayShell();

  if (loading && !sessionId) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting to shell on the gateway…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive max-w-md text-center">{error}</p>
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

  if (!sessionId) return null;

  return (
    <div className="flex h-full w-full flex-1 overflow-hidden">
      <XtermPane
        key={sessionId}
        wsUrl={buildGatewayXtermUrl(ctx.id, sessionId)}
        endedAction={{
          label: "Start new shell",
          onClick: () => openShell(true),
        }}
      />
    </div>
  );
}

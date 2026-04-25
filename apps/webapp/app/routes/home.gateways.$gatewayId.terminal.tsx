import { useOutletContext } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  XtermPane,
  buildGatewayXtermUrl,
} from "~/components/gateway/xterm-pane";
import type { GatewayOutletContext } from "./home.gateways.$gatewayId";

export default function GatewayTerminalTab() {
  const ctx = useOutletContext<GatewayOutletContext>();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  // Spawn a shell every time the user opens this tab (or hits restart).
  // Cheap enough — `ptyManager` reaps exited handles, and the gateway just
  // boots `$SHELL` in `$COREBRAIN_DEFAULT_WORKSPACE` (or the home dir).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSessionId(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/v1/gateways/${ctx.gatewayId}/shell`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          sessionId?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.sessionId) {
          throw new Error(body.error ?? `shell failed (${res.status})`);
        }
        setSessionId(body.sessionId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ctx.gatewayId, restartKey]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting shell on the gateway…
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
          onClick={() => setRestartKey((k) => k + 1)}
        >
          <RefreshCcw size={12} />
          Try again
        </Button>
      </div>
    );
  }

  if (!sessionId) return null;

  return (
    <div className="h-full w-full">
      <XtermPane
        key={`${sessionId}`}
        wsUrl={buildGatewayXtermUrl(ctx.gatewayId, sessionId)}
        endedAction={{
          label: "Restart shell",
          onClick: () => setRestartKey((k) => k + 1),
        }}
      />
    </div>
  );
}

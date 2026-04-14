import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useTauri } from "~/hooks/use-tauri";
import "@xterm/xterm/css/xterm.css";

type TerminalState = "spawning" | "running" | "ended" | "error";

interface Props {
  sessionDbId: string;
  agent: string;
  dir: string;
  externalSessionId?: string;
  onNewSession: () => void;
  onResumeSession: (extId: string) => void;
  onSessionIdUpdated?: (sessionDbId: string, extId: string) => void;
}

async function tauriListen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<(() => void) | null> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen(event, (e: { payload: unknown }) =>
      handler(e.payload),
    );
    return unlisten;
  } catch {
    return null;
  }
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function TauriTerminal({
  sessionDbId,
  agent,
  dir,
  externalSessionId: initialExternalSessionId,
  onNewSession,
  onResumeSession,
  onSessionIdUpdated,
}: Props) {
  const { invoke } = useTauri();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const unlistenersRef = useRef<Array<() => void>>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const statusRef = useRef<TerminalState>("spawning");

  const [status, setStatus] = useState<TerminalState>("spawning");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [externalSessionId, setExternalSessionId] = useState(
    initialExternalSessionId,
  );

  const setStatusBoth = (s: TerminalState) => {
    statusRef.current = s;
    setStatus(s);
  };

  const updateSessionId = useCallback(
    async (extId: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/v1/coding-sessions/${sessionDbId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ externalSessionId: extId }),
          });
          if (res.ok) {
            setExternalSessionId(extId);
            onSessionIdUpdated?.(sessionDbId, extId);
            return;
          }
        } catch {
          // retry
        }
        await delay(500 * Math.pow(2, attempt));
      }
      console.warn(
        "Session ID could not be saved — this session may not be resumable",
      );
    },
    [sessionDbId],
  );

  useEffect(() => {
    let mounted = true;

    async function setup() {
      if (!containerRef.current) return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (!mounted || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        theme: {
          background: "#161616",
          foreground: "#ededed",
          cursor: "#6b9bff",
          black: "#161616",
          brightBlack: "#444444",
        },
        allowTransparency: false,
        scrollback: 5000,
        overviewRulerWidth: 0,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current);

      // Wait for font to be ready before measuring character dimensions
      await document.fonts.ready;

      // Wait until the container has non-zero dimensions — react-resizable-panels
      // sets panel sizes via JS after mount, so a fixed RAF count isn't reliable.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (containerRef.current && containerRef.current.offsetHeight > 0) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
      fitAddon.fit();
      term.focus();

      termRef.current = term;

      // Listen for PTY events
      const dataUnsub = await tauriListen(
        `pty://data/${sessionDbId}`,
        (payload) => {
          if (typeof payload === "string") {
            term.write(payload);
          }
          if (statusRef.current === "spawning" && mounted)
            setStatusBoth("running");
        },
      );

      const exitUnsub = await tauriListen(`pty://exit/${sessionDbId}`, () => {
        if (mounted) setStatusBoth("ended");
      });

      const errorUnsub = await tauriListen(
        `pty://error/${sessionDbId}`,
        (payload) => {
          const msg = (payload as any)?.message ?? "An error occurred";
          if (mounted) {
            setErrorMsg(msg);
            setStatusBoth("error");
          }
        },
      );

      const sessionIdUnsub = await tauriListen(
        `pty://session-id/${sessionDbId}`,
        (payload) => {
          const extId = (payload as any)?.externalSessionId;
          if (extId && mounted && !initialExternalSessionId) updateSessionId(extId);
        },
      );

      [dataUnsub, exitUnsub, errorUnsub, sessionIdUnsub].forEach((u) => {
        if (u) unlistenersRef.current.push(u);
      });

      term.onData((data) => {
        invoke("write_pty", { sessionDbId, data });
      });

      const ro = new ResizeObserver(() => {
        fitAddon.fit();
        invoke("resize_pty", {
          sessionDbId,
          cols: term.cols,
          rows: term.rows,
        });
      });
      if (containerRef.current) ro.observe(containerRef.current);
      resizeObserverRef.current = ro;

      // Spawn
      try {
        await invoke("spawn_pty", {
          sessionDbId,
          agent,
          dir,
          resumeSessionId: initialExternalSessionId ?? null,
          cols: term.cols || 80,
          rows: term.rows || 24,
        });
        // Re-fit after spawn in case the panel settled further, then sync PTY dims
        requestAnimationFrame(() => {
          if (!mounted) return;
          fitAddon.fit();
          invoke("resize_pty", {
            sessionDbId,
            cols: term.cols,
            rows: term.rows,
          });
        });
      } catch (err) {
        if (mounted) {
          setErrorMsg(String(err));
          setStatusBoth("error");
        }
      }
    }

    setup();

    return () => {
      mounted = false;
      unlistenersRef.current.forEach((u) => u());
      unlistenersRef.current = [];
      resizeObserverRef.current?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionDbId]);

  if (status === "error") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 px-8"
        style={{ background: "oklch(21.34% 0 0)" }}
      >
        <AlertCircle
          className="h-8 w-8"
          style={{ color: "oklch(65% 0.2 25)" }}
        />
        <p
          className="text-center font-mono text-sm font-medium"
          style={{ color: "oklch(65% 0.2 25)" }}
        >
          {errorMsg}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onNewSession}
        >
          New session
        </Button>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: "#161616",
        display: "flex",
        flexDirection: "column",
        paddingLeft: 8,
        paddingBottom: 12,
      }}
    >
      {status === "spawning" && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{ background: "#161616" }}
        >
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "oklch(60% 0 0)" }}
          />
        </div>
      )}

      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        onClick={() => termRef.current?.focus()}
      />

      {status === "ended" && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
          style={{
            background: "oklch(21.34% 0 0 / 0.85)",
            backdropFilter: "blur(4px)",
          }}
        >
          <CheckCircle2
            className="h-8 w-8"
            style={{ color: "oklch(60% 0 0)" }}
          />
          <p
            className="text-sm font-medium"
            style={{ color: "oklch(92.8% 0 0)" }}
          >
            Session ended
          </p>
          <div className="flex gap-2">
            {externalSessionId && (
              <Button
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => onResumeSession(externalSessionId)}
              >
                Resume session
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-white/70 hover:bg-white/10 hover:text-white"
              onClick={onNewSession}
            >
              New session
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

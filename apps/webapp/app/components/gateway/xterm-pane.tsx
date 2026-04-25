import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { terminalThemes } from "~/components/coding/terminal-themes";
import "@xterm/xterm/css/xterm.css";
import { Button } from "../ui";

type TerminalState = "connecting" | "running" | "ended" | "error";

interface Props {
  /**
   * Fully-qualified WebSocket URL the xterm connects to. Supplied by the
   * caller so this component is decoupled from any particular session shape
   * (CodingSession, gateway-direct login, gateway-direct shell, etc.).
   */
  wsUrl: string;
  /** Optional: render an action button in the "ended" overlay. */
  endedAction?: { label: string; onClick: () => void };
  /** Optional: notify parent when the PTY exits (used by login dialog). */
  onExit?: () => void;
  /** Optional: hide the "Session ended" overlay (used by login dialog where
   *  the parent dismisses on exit). */
  hideEndedOverlay?: boolean;
}

function useHtmlTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  });

  useEffect(() => {
    const mo = new MutationObserver(() => {
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    });
    mo.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return theme;
}

/**
 * Generic xterm pane attached to an arbitrary WebSocket. Lifecycle:
 *   - Opens xterm + WS on mount (status: "connecting").
 *   - Streams frames in both directions.
 *   - PTY exit (kind=exit JSON or WS close) → status: "ended".
 *   - Errors → status: "error".
 *
 * URL changes remount the terminal, so callers can rotate `wsUrl` to
 * reconnect / replay.
 */
export function XtermPane({
  wsUrl,
  endedAction,
  onExit,
  hideEndedOverlay,
}: Props) {
  const theme = useHtmlTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const statusRef = useRef<TerminalState>("connecting");

  const [status, setStatus] = useState<TerminalState>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const xtermTheme = terminalThemes[theme];
  const bg = xtermTheme.background as string;

  const setStatusBoth = (s: TerminalState) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = xtermTheme;
    termRef.current.options.minimumContrastRatio = theme === "light" ? 4.5 : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    let localTerm: import("@xterm/xterm").Terminal | null = null;
    let localWs: WebSocket | null = null;
    let localRo: ResizeObserver | null = null;

    async function setup() {
      if (!containerRef.current) return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (!mounted || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        theme: xtermTheme,
        allowTransparency: false,
        scrollback: 5000,
        overviewRulerWidth: 0,
        minimumContrastRatio: theme === "light" ? 4.5 : 1,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      if (!mounted) {
        term.dispose();
        return;
      }
      localTerm = term;
      term.open(containerRef.current);

      await document.fonts.ready;
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
      if (!mounted) {
        term.dispose();
        localTerm = null;
        return;
      }
      fitAddon.fit();
      term.focus();
      termRef.current = term;

      const ws = new WebSocket(wsUrl);
      localWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setStatusBoth("running");
        ws.send(
          JSON.stringify({
            kind: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      };

      ws.onmessage = (ev) => {
        if (!mounted) return;
        const data =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof Blob
              ? null
              : ev.data instanceof ArrayBuffer
                ? new TextDecoder().decode(ev.data)
                : String(ev.data);

        if (data === null) {
          (ev.data as Blob).text().then((t) => term.write(t));
          return;
        }

        if (data.startsWith("{")) {
          try {
            const parsed = JSON.parse(data);
            if (
              parsed &&
              typeof parsed === "object" &&
              parsed.kind === "exit"
            ) {
              if (mounted) {
                setStatusBoth("ended");
                onExit?.();
              }
              return;
            }
          } catch {
            /* not JSON — fall through */
          }
        }
        term.write(data);
      };

      ws.onerror = () => {
        if (!mounted) return;
        setErrorMsg("Connection error");
        setStatusBoth("error");
      };

      ws.onclose = () => {
        if (!mounted) return;
        if (statusRef.current !== "error" && statusRef.current !== "ended") {
          setStatusBoth("ended");
          onExit?.();
        }
      };

      term.onData((input) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: "input", data: input }));
        }
      });

      let rafId: number | null = null;
      const ro = new ResizeObserver(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                kind: "resize",
                cols: term.cols,
                rows: term.rows,
              }),
            );
          }
          rafId = null;
        });
      });
      if (containerRef.current) ro.observe(containerRef.current);
      localRo = ro;
      resizeObserverRef.current = ro;
    }

    setup();

    return () => {
      mounted = false;
      if (localWs && localWs.readyState !== WebSocket.CLOSED) {
        localWs.close();
      }
      if (wsRef.current === localWs) wsRef.current = null;
      localRo?.disconnect();
      if (resizeObserverRef.current === localRo)
        resizeObserverRef.current = null;
      localTerm?.dispose();
      if (termRef.current === localTerm) termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  if (status === "error") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-8"
        style={{ background: bg }}
      >
        <AlertCircle
          className="h-8 w-8"
          style={{ color: "oklch(60% 0.13 30)" }}
        />
        <p
          className="text-center font-mono text-sm font-medium"
          style={{ color: "oklch(60% 0.13 30)" }}
        >
          {errorMsg}
        </p>
        {endedAction ? (
          <Button
            type="button"
            variant="secondary"
            onClick={endedAction.onClick}
          >
            {endedAction.label}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: bg,
        display: "flex",
        flexDirection: "column",

        padding: 12,
      }}
    >
      {status === "connecting" && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{ background: bg }}
        >
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "oklch(60% 0 0)" }}
          />
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          overflow: "hidden",
        }}
        onClick={() => termRef.current?.focus()}
      />

      {status === "ended" && !hideEndedOverlay && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          style={{
            background: `color-mix(in oklch, ${bg} 45%, transparent)`,
            backdropFilter: "blur(1px)",
          }}
        >
          <CheckCircle2
            className="h-8 w-8"
            style={{ color: "oklch(60% 0 0)" }}
          />
          <p
            className="text-md font-medium"
            style={{ color: xtermTheme.foreground as string }}
          >
            Session ended
          </p>
          {endedAction ? (
            <button
              type="button"
              className="text-foreground bg-grayAlpha-100 hover:bg-grayAlpha-200 rounded px-3 py-1.5 text-xs font-medium"
              onClick={endedAction.onClick}
            >
              {endedAction.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function buildGatewayXtermUrl(
  gatewayId: string,
  externalSessionId: string,
): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/gateways/${encodeURIComponent(
    gatewayId,
  )}/xterm?session_id=${encodeURIComponent(externalSessionId)}`;
}

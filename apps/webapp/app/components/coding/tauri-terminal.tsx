import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useTauri } from "~/hooks/use-tauri";
import { terminalThemes } from "./terminal-themes";
import "@xterm/xterm/css/xterm.css";

// Read theme from <html> class instead of remix-themes context — avoids
// "useTheme must be used within ThemeProvider" errors inside ClientOnly.
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
  const theme = useHtmlTheme();
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

  const resolvedTheme = theme;
  const xtermTheme = terminalThemes[resolvedTheme];
  const bg = xtermTheme.background as string;

  const setStatusBoth = (s: TerminalState) => {
    statusRef.current = s;
    setStatus(s);
  };

  // Update xterm theme + contrast enforcement when app theme changes
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = xtermTheme;
    termRef.current.options.minimumContrastRatio =
      resolvedTheme === "light" ? 4.5 : 1;
  }, [resolvedTheme]); // eslint-disable-line react-hooks/exhaustive-deps

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
        fontSize: 13,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        theme: xtermTheme,
        allowTransparency: false,
        scrollback: 5000,
        overviewRulerWidth: 0,
        // Automatically adjusts any color (including 256-color/true-color)
        // that has insufficient contrast against the background.
        // This fixes white dots/text that bypass the 16-color theme palette.
        minimumContrastRatio: resolvedTheme === "light" ? 4.5 : 1,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current);

      // Wait for font to be ready before measuring character dimensions
      await document.fonts.ready;

      // Wait until the container has stable non-zero dimensions. We check both
      // width and height stability so we don't measure mid-animation (sidebar
      // collapse) or before react-resizable-panels has applied its JS-driven
      // flex sizes via useEffect (which sets the panel's final height).
      await new Promise<void>((resolve) => {
        let lastWidth = -1;
        let lastHeight = -1;
        const check = () => {
          const el = containerRef.current;
          if (!el) { resolve(); return; }
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (h > 0 && w > 0 && w === lastWidth && h === lastHeight) {
            resolve();
          } else {
            lastWidth = w;
            lastHeight = h;
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
          if (extId && mounted && !initialExternalSessionId)
            updateSessionId(extId);
        },
      );

      [dataUnsub, exitUnsub, errorUnsub, sessionIdUnsub].forEach((u) => {
        if (u) unlistenersRef.current.push(u);
      });

      term.onData((data) => {
        invoke("write_pty", { sessionDbId, data });
      });

      let rafId: number | null = null;
      const ro = new ResizeObserver(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          fitAddon.fit();
          invoke("resize_pty", {
            sessionDbId,
            cols: term.cols,
            rows: term.rows,
          });
          rafId = null;
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
        <Button size="sm" variant="ghost" onClick={onNewSession}>
          New session
        </Button>
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
        paddingLeft: 8,
        paddingRight: 8,
        paddingBottom: 12,
      }}
    >
      {status === "spawning" && (
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

      {status === "ended" && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
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
          <div className="flex gap-2">
            {externalSessionId && (
              <Button
                variant="ghost"
                onClick={() => onResumeSession(externalSessionId)}
              >
                Resume session
              </Button>
            )}
            <Button variant="secondary" onClick={onNewSession}>
              New session
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  MousePointerClick,
  Power,
  RefreshCcw,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { useCdpScreencast } from "./use-cdp-screencast";

interface Props {
  /** WebSocket URL pointing at the webapp's browser-CDP proxy. */
  wsUrl: string;
  /** Format quality 0–100 (jpeg only — png ignores). */
  quality?: number;
  /** Max frame width Chromium ships. Smaller = lower bandwidth. */
  maxWidth?: number;
  /** Optional content rendered at the right edge of the merged header
   *  (e.g. a Delete button for the active session). */
  actionsNode?: ReactNode;
  /** Optional content rendered at the left edge of the merged header
   *  (e.g. a session/profile label). */
  leadingNode?: ReactNode;
}

/**
 * Single-header browser shell — combines status, navigation, URL bar, take-
 * control toggle, and a slot for caller-supplied actions (e.g. Delete) into
 * one row. Mouse events on the canvas are forwarded only when `hasControl`
 * is on; keyboard listeners are wired/unwired based on the same flag.
 */
export function CdpViewer({
  wsUrl,
  quality = 70,
  maxWidth = 1280,
  actionsNode,
  leadingNode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    status,
    errorMsg,
    canvasRef,
    pageUrl,
    navigate,
    goBack,
    goForward,
    reload,
    dispatchMouse,
    dispatchWheel,
    dispatchKey,
    reconnect,
    setViewport,
  } = useCdpScreencast({ wsUrl, quality, maxWidth });

  // Resize the remote Chromium viewport to match the canvas's container.
  // Debounced because ResizeObserver fires per-frame during a window-drag;
  // pushing every intermediate size to CDP would flood the channel and
  // trigger constant page reflows on the remote side.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setViewport(
        Math.floor(rect.width),
        Math.floor(rect.height),
        window.devicePixelRatio || 1,
      );
    };

    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(apply, 150);
    });
    ro.observe(node);
    apply();

    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [setViewport]);
  const [hasControl, setHasControl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);
  // Track focus explicitly via onFocus / onBlur instead of reading
  // `document.activeElement`. WKWebView (Tauri's webview) reports
  // activeElement inconsistently relative to the React render cycle, so the
  // guard would mis-fire and clobber the typed character with `pageUrl`,
  // which manifests as "the URL bar drops focus after one letter".
  const isUrlFocusedRef = useRef(false);
  useEffect(() => {
    if (!isUrlFocusedRef.current) {
      setUrlInput(pageUrl);
    }
  }, [pageUrl]);

  useEffect(() => {
    if (!hasControl) return;
    const node = containerRef.current;
    if (!node) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      dispatchKey("keyDown", e);
      if (e.key.length === 1) dispatchKey("char", e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      dispatchKey("keyUp", e);
    };
    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("keyup", onKeyUp);
    node.focus();
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("keyup", onKeyUp);
    };
  }, [hasControl, dispatchKey]);

  // React's onWheel attaches passively, so preventDefault() is a no-op there
  // and the parent container would scroll instead of the remote page. Bind
  // non-passively so we can swallow the local scroll and forward the delta.
  useEffect(() => {
    if (!hasControl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dispatchWheel(e);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [hasControl, dispatchWheel, canvasRef]);

  const isRunning = status === "running";

  return (
    <div className="bg-background-2 relative flex h-full w-full flex-col">
      <form
        className="bg-background-2 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isRunning) return;
          navigate(urlInput);
          urlInputRef.current?.blur();
        }}
      >
        {leadingNode ? (
          <div className="flex shrink-0 items-center gap-2 pr-1">
            {leadingNode}
          </div>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Back"
          onClick={goBack}
          disabled={!isRunning}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Forward"
          onClick={goForward}
          disabled={!isRunning}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Reload"
          onClick={reload}
          disabled={!isRunning}
        >
          <RefreshCcw size={14} />
        </Button>

        <Input
          ref={urlInputRef}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={(e) => {
            isUrlFocusedRef.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            isUrlFocusedRef.current = false;
          }}
          placeholder={isRunning ? "Enter URL or search…" : ""}
          className="h-7 flex-1 font-mono text-xs"
          disabled={!isRunning}
        />

        <div className="text-muted-foreground flex shrink-0 items-center gap-1.5 pl-1">
          {status === "connecting" && (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span className="hidden md:inline">Connecting…</span>
            </>
          )}

          {status === "ended" && (
            <span className="hidden md:inline">Disconnected</span>
          )}
          {status === "error" && (
            <span className="text-destructive">{errorMsg}</span>
          )}
        </div>

        {isRunning && (
          <Button
            type="button"
            variant={hasControl ? "secondary" : "ghost"}
            size="sm"
            className="h-7 shrink-0 gap-1.5"
            onClick={() => setHasControl((v) => !v)}
          >
            <Power size={12} />
            {hasControl ? "Release" : "Take control"}
          </Button>
        )}
        {(status === "ended" || status === "error") && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 shrink-0 gap-1.5"
            onClick={reconnect}
          >
            <RefreshCcw size={12} />
            Reconnect
          </Button>
        )}

        {actionsNode ? (
          <div className="flex shrink-0 items-center gap-1 pl-1">
            {actionsNode}
          </div>
        ) : null}
      </form>

      <div
        ref={containerRef}
        tabIndex={0}
        className={cn(
          "relative flex-1 overflow-hidden outline-none",
          hasControl ? "cursor-crosshair" : "cursor-default",
        )}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onContextMenu={(e) => hasControl && e.preventDefault()}
          onMouseMove={(e) => hasControl && dispatchMouse("mouseMoved", e)}
          onMouseDown={(e) => hasControl && dispatchMouse("mousePressed", e)}
          onMouseUp={(e) => hasControl && dispatchMouse("mouseReleased", e)}
        />
        {status === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin opacity-50" />
          </div>
        )}
      </div>
    </div>
  );
}

export { buildCdpWsUrl } from "./cdp-client";

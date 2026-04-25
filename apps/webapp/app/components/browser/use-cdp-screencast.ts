import { useEffect, useRef, useState } from "react";
import { CdpClient, eventModifiers } from "./cdp-client";

export type ScreencastStatus = "connecting" | "running" | "ended" | "error";

interface ScreencastFrameMetadata {
  offsetTop?: number;
  pageScaleFactor?: number;
  deviceWidth?: number;
  deviceHeight?: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  timestamp?: number;
}
interface ScreencastFrameParams {
  data: string; // base64 png
  sessionId: number; // CDP screencast frame ack id (different from Target sessionId)
  metadata: ScreencastFrameMetadata;
}

interface Options {
  wsUrl: string;
  /** Format quality 0-100 (only honored for `jpeg`). PNG ignores this. */
  quality?: number;
  /** Max frame width Chromium ships (lower = lower bandwidth). */
  maxWidth?: number;
}

export interface ScreencastApi {
  /** Live status of the screencast attach lifecycle. */
  status: ScreencastStatus;
  /** Error string when `status === "error"`. */
  errorMsg: string;
  /** Attach to the canvas the hook should render frames into. */
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Current URL of the attached page (updated as the page navigates). */
  pageUrl: string;
  /** Page nav controls — backed by Chromium CDP commands. No-op until running. */
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  /** Forward a mouse event from the canvas. No-op until `running`. */
  dispatchMouse: (
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    e: React.MouseEvent<HTMLCanvasElement>,
  ) => void;
  /** Forward a wheel event from the canvas. No-op until `running`. */
  dispatchWheel: (e: WheelEvent) => void;
  /** Forward a keyboard event from the focused container. No-op until `running`. */
  dispatchKey: (type: "keyDown" | "keyUp" | "char", e: KeyboardEvent) => void;
  /** Force a fresh CDP connection (reconnect after a drop). */
  reconnect: () => void;
}

interface NavigationHistoryEntry {
  id: number;
  url: string;
  title: string;
  transitionType: string;
}
interface NavigationHistory {
  currentIndex: number;
  entries: NavigationHistoryEntry[];
}

/**
 * Connect to Chrome DevTools Protocol over the proxied WebSocket and stream
 * `Page.screencastFrame` images into a canvas. Also exposes mouse/keyboard
 * dispatch helpers for "take control".
 *
 * Flow on each connect:
 *   1. Open WebSocket → wrap with `CdpClient`.
 *   2. `Target.setDiscoverTargets {discover:true}` and `Target.getTargets`
 *      to find the page target.
 *   3. `Target.attachToTarget {flatten:true}` → returns a per-page
 *      `sessionId` we use for all subsequent page-level commands.
 *   4. Subscribe to `Page.screencastFrame` events on that sessionId.
 *   5. `Page.startScreencast` — Chromium begins emitting frames.
 *   6. Each frame must be ack'd via `Page.screencastFrameAck` or Chromium
 *      throttles future frames.
 */
export function useCdpScreencast({
  wsUrl,
  quality = 70,
  maxWidth = 1280,
}: Options): ScreencastApi {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cdpRef = useRef<CdpClient | null>(null);
  const pageSessionRef = useRef<string>("");

  const [status, setStatus] = useState<ScreencastStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pageUrl, setPageUrl] = useState<string>("");
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");
    setErrorMsg("");

    const ws = new WebSocket(wsUrl);
    const cdp = new CdpClient(ws);
    cdpRef.current = cdp;

    ws.addEventListener("error", () => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg("Connection error");
    });
    ws.addEventListener("close", () => {
      if (cancelled) return;
      setStatus((s) => (s === "error" ? s : "ended"));
    });

    ws.addEventListener("open", async () => {
      // Bail if React already cleaned this effect up (StrictMode double-
      // mount, prop change). Avoids opening Chromium targets that we'll
      // immediately abandon.
      if (cancelled) return;
      try {
        // eslint-disable-next-line no-console
        console.log("[cdp-viewer] ws open, requesting targets");
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        // eslint-disable-next-line no-console
        console.log("[cdp-viewer] setDiscoverTargets ack");
        const { targetInfos } = await cdp.send<{
          targetInfos: Array<{ targetId: string; type: string }>;
        }>("Target.getTargets");
        // eslint-disable-next-line no-console
        console.log(
          "[cdp-viewer] getTargets returned",
          targetInfos.map((t) => `${t.type}:${t.targetId.slice(0, 8)}`),
        );
        const pageTarget = targetInfos.find((t) => t.type === "page");
        if (!pageTarget) throw new Error("no page target found");

        const { sessionId } = await cdp.send<{ sessionId: string }>(
          "Target.attachToTarget",
          { targetId: pageTarget.targetId, flatten: true },
        );
        // eslint-disable-next-line no-console
        console.log("[cdp-viewer] attached to page", sessionId);
        pageSessionRef.current = sessionId;

        // Enable Page domain for navigation events. `Page.frameNavigated`
        // fires for the main frame on every navigation, which we use to
        // keep `pageUrl` in sync with what the agent / user navigates to.
        await cdp.send("Page.enable", {}, sessionId);
        if (pageTarget.url && !cancelled) setPageUrl(pageTarget.url);
        cdp.on(sessionId, (method, params) => {
          if (method !== "Page.frameNavigated") return;
          const p = params as {
            frame: { id: string; parentId?: string; url: string };
          };
          // Only the top-level frame's URL is what we show in the address bar.
          if (!p.frame.parentId && !cancelled) setPageUrl(p.frame.url);
        });

        // Wire frame listener BEFORE startScreencast — Chromium can emit the
        // first frame synchronously.
        cdp.on(sessionId, (method, params) => {
          if (method !== "Page.screencastFrame") return;
          const p = params as ScreencastFrameParams;
          // Ack first so Chromium keeps shipping frames.
          cdp
            .send(
              "Page.screencastFrameAck",
              { sessionId: p.sessionId },
              sessionId,
            )
            .catch(() => {
              /* swallow */
            });

          const canvas = canvasRef.current;
          if (!canvas) return;
          const img = new Image();
          img.onload = () => {
            if (cancelled) return;
            if (canvas.width !== img.width || canvas.height !== img.height) {
              canvas.width = img.width;
              canvas.height = img.height;
            }
            const ctx = canvas.getContext("2d");
            if (ctx) ctx.drawImage(img, 0, 0);
          };
          img.src = `data:image/png;base64,${p.data}`;
        });

        await cdp.send(
          "Page.startScreencast",
          {
            format: "png",
            quality,
            maxWidth,
            maxHeight: maxWidth * 2,
            everyNthFrame: 1,
          },
          sessionId,
        );
        // eslint-disable-next-line no-console
        console.log("[cdp-viewer] startScreencast ack");

        if (!cancelled) setStatus("running");
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[cdp-viewer] CDP setup failed", err);
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      cancelled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [wsUrl, reconnectKey, quality, maxWidth]);

  /**
   * Coerce a user-typed value into a navigable URL. Bare hostnames /
   * URL-ish strings get a `https://` prefix; anything else falls back to a
   * Google search. Mirrors how Chrome's omnibox treats unparseable input.
   */
  const coerceUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    // Looks domain-ish: contains a dot, no spaces.
    if (/^[^\s/]+\.[^\s/]+/i.test(trimmed) && !trimmed.includes(" ")) {
      return `https://${trimmed}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  };

  const navigate: ScreencastApi["navigate"] = (url) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    const target = coerceUrl(url);
    if (!target) return;
    cdp.send("Page.navigate", { url: target }, sid).catch(() => {
      /* swallow — navigation errors surface via Page.frameNavigated anyway */
    });
  };

  const reload: ScreencastApi["reload"] = () => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    cdp.send("Page.reload", {}, sid).catch(() => {});
  };

  /**
   * CDP doesn't expose a `Page.goBack` shortcut. We grab the navigation
   * history and step `currentIndex ± 1` via `Page.navigateToHistoryEntry`.
   */
  const stepHistory = async (delta: -1 | 1): Promise<void> => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    try {
      const hist = await cdp.send<NavigationHistory>(
        "Page.getNavigationHistory",
        {},
        sid,
      );
      const target = hist.entries[hist.currentIndex + delta];
      if (!target) return;
      await cdp.send(
        "Page.navigateToHistoryEntry",
        { entryId: target.id },
        sid,
      );
    } catch {
      /* swallow */
    }
  };

  const goBack: ScreencastApi["goBack"] = () => {
    void stepHistory(-1);
  };
  const goForward: ScreencastApi["goForward"] = () => {
    void stepHistory(1);
  };

  const dispatchMouse: ScreencastApi["dispatchMouse"] = (type, e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    const canvas = canvasRef.current;
    if (!cdp || !sid || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    cdp
      .send(
        "Input.dispatchMouseEvent",
        {
          type,
          x,
          y,
          button:
            type === "mouseMoved"
              ? "none"
              : e.button === 2
                ? "right"
                : "left",
          clickCount:
            type === "mouseReleased" || type === "mousePressed" ? 1 : 0,
          modifiers: eventModifiers(e),
        },
        sid,
      )
      .catch(() => {
        /* swallow */
      });
  };

  const dispatchWheel: ScreencastApi["dispatchWheel"] = (e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    const canvas = canvasRef.current;
    if (!cdp || !sid || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // CDP wants pixel deltas. WheelEvent.deltaMode 0 = pixel (passthrough),
    // 1 = line (~16px), 2 = page (rare; approximate against viewport).
    const lineHeight = 16;
    const pageHeight = rect.height || 800;
    const factor =
      e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? pageHeight : 1;
    const deltaX = e.deltaX * factor;
    const deltaY = e.deltaY * factor;

    cdp
      .send(
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x,
          y,
          deltaX,
          deltaY,
          modifiers: eventModifiers(e),
        },
        sid,
      )
      .catch(() => {
        /* swallow */
      });
  };

  const dispatchKey: ScreencastApi["dispatchKey"] = (type, e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    const isPrintable = e.key.length === 1;
    // CDP's `keyDown` auto-inserts text when the `text` field is set, so a
    // follow-up `char` would insert the same character twice. Use `rawKeyDown`
    // for printable keys — it fires the keydown event without insertion, and
    // the paired `char` dispatch handles the actual text input.
    const cdpType = type === "keyDown" && isPrintable ? "rawKeyDown" : type;
    const params: Record<string, unknown> = {
      type: cdpType,
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      modifiers: eventModifiers(e),
    };
    if (isPrintable) params.text = e.key;
    cdp.send("Input.dispatchKeyEvent", params, sid).catch(() => {
      /* swallow */
    });
  };

  return {
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
    reconnect: () => setReconnectKey((k) => k + 1),
  };
}

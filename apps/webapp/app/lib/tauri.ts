/**
 * Tauri / WKWebView client helpers — safe in SSR (no-op outside).
 *
 * The voice widget can run inside two hosts:
 *   - Tauri main webview (regular Tauri pages) — use __TAURI_INTERNALS__
 *   - Swift core-voice WKWebView (the floating voice panel) — use
 *     webkit.messageHandlers and listen for window CustomEvents that
 *     Swift dispatches via evaluateJavaScript
 *
 * `voiceInvoke` / `voiceListen` route to whichever host is active.
 * `tauriInvoke` / `tauriListen` are kept for non-voice Tauri callers.
 */

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__TAURI_INTERNALS__);
}

export function isWebkitVoiceHost(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return (
    w.__VOICE_HOST__ === "webkit" &&
    Boolean(w.webkit?.messageHandlers?.voice)
  );
}

export function voicePAT(): string | null {
  if (typeof window === "undefined") return null;
  return (window as any).__VOICE_PAT__ ?? null;
}

export async function tauriInvoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  const internals = (window as any).__TAURI_INTERNALS__;
  return internals.invoke(command, args ?? {}) as Promise<T>;
}

export async function tauriListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<T>(event, handler as any);
  return unlisten;
}

/**
 * Invoke a voice helper command — works in both Tauri and the Swift
 * WKWebView host. Maps `voice_start_listening` / `voice_speak` etc. to
 * the right transport for each.
 */
export async function voiceInvoke(
  command:
    | "voice_request_permissions"
    | "voice_start_listening"
    | "voice_stop_listening"
    | "voice_speak"
    | "voice_cancel_speech"
    | "voice_hide",
  args?: Record<string, unknown>,
): Promise<void> {
  if (isWebkitVoiceHost()) {
    const map: Record<string, string> = {
      voice_request_permissions: "request_permissions",
      voice_start_listening: "start_listening",
      voice_stop_listening: "stop_listening",
      voice_speak: "speak",
      voice_cancel_speech: "cancel_speech",
      voice_hide: "hide",
    };
    const cmd = map[command] ?? command;
    (window as any).webkit.messageHandlers.voice.postMessage({ cmd, ...args });
    return;
  }
  if (isTauri()) {
    await tauriInvoke(command, args);
  }
}

/**
 * Listen for a voice helper event (`voice:partial`, `voice:final`,
 * `voice:invoke-payload`, etc.). In the Swift WKWebView host the
 * helper dispatches CustomEvents on `window`. In Tauri it goes through
 * the Tauri event bus.
 */
export async function voiceListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (isWebkitVoiceHost()) {
    const fn = (e: Event) => handler({ payload: (e as CustomEvent).detail });
    window.addEventListener(event, fn as EventListener);
    return () => window.removeEventListener(event, fn as EventListener);
  }
  return tauriListen<T>(event, handler);
}

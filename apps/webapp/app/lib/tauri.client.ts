/**
 * Tauri client helpers — safe in SSR (no-op outside Tauri).
 *
 * Imports are deferred so the Remix server bundle never tries to
 * resolve runtime-only Tauri internals.
 */

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__TAURI_INTERNALS__);
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

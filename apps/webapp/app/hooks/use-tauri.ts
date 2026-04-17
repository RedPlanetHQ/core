import { useState, useCallback } from "react";

function getTauriInternals() {
  if (typeof window === "undefined") return null;
  return (window as any).__TAURI_INTERNALS__ ?? null;
}

/**
 * Returns Tauri-specific utilities.
 *
 * `isDesktop` — true only when running inside the CORE Tauri desktop app.
 * `invoke`    — calls a Tauri command; no-ops silently outside Tauri.
 */
export function useTauri() {
  // Lazy initializer runs synchronously on the client so `isDesktop` is
  // correct on the very first render — no useEffect flash.
  const [isDesktop] = useState(() => getTauriInternals() !== null);

  const invoke = useCallback(
    async <T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T | null> => {
      const tauri = getTauriInternals();
      if (!tauri) return null;
      return tauri.invoke(command, args ?? {}) as Promise<T>;
    },
    [],
  );

  return { isDesktop, invoke };
}

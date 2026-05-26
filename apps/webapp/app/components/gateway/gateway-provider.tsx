import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { DeployMode, Folder } from "@redplanethq/gateway-protocol";

/**
 * Manifest-derived state for a single gateway. Server-rendered by the
 * layout loader; the loader auto-revalidates so this snapshot stays fresh.
 * Children read it via `useGateway()` instead of nested outlet contexts.
 */
export interface GatewaySnapshot {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
  status: "CONNECTED" | "DISCONNECTED";
  deployMode: DeployMode;
  hostname: string | null;
  platform: string | null;
  folders: Folder[];
  agents: string[];
}

interface GatewayContextValue extends GatewaySnapshot {
  /** Re-run the layout loader — used after folder add/remove so the list updates. */
  refresh: () => void;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

interface ProviderProps {
  snapshot: GatewaySnapshot;
  refresh: () => void;
  children: React.ReactNode;
}

export function GatewayProvider({ snapshot, refresh, children }: ProviderProps) {
  const value = useMemo<GatewayContextValue>(
    () => ({ ...snapshot, refresh }),
    [snapshot, refresh],
  );
  return (
    <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
  );
}

export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error("useGateway must be used inside a <GatewayProvider>");
  }
  return ctx;
}

/**
 * Shell session managed at the gateway-layout level so the PageHeader's
 * "New shell" button (in the layout) and the terminal route's xterm pane
 * (in the route Outlet) share the same lifecycle. Backend persistence
 * (see `ptyManager` scrollback + `attach.replayed`) handles continuity
 * across route remounts.
 */
interface GatewayShellState {
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  openShell: (fresh: boolean) => void;
}

const GatewayShellContext = createContext<GatewayShellState | null>(null);

interface ShellResponse {
  sessionId?: string;
  resumed?: boolean;
  error?: string;
}

export function GatewayShellProvider({
  gatewayId,
  children,
}: {
  gatewayId: string;
  children: React.ReactNode;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openShell = useCallback(
    async (fresh: boolean) => {
      setLoading(true);
      setError(null);
      if (fresh) setSessionId(null);
      try {
        const res = await fetch(`/api/v1/gateways/${gatewayId}/shell`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fresh }),
        });
        const body = (await res.json().catch(() => ({}))) as ShellResponse;
        if (!res.ok || !body.sessionId) {
          throw new Error(body.error ?? `shell failed (${res.status})`);
        }
        setSessionId(body.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [gatewayId],
  );

  // Spawn / resume on layout mount so the terminal is ready when the user
  // first clicks the tab.
  useEffect(() => {
    setSessionId(null);
    void openShell(false);
  }, [gatewayId, openShell]);

  const value = useMemo<GatewayShellState>(
    () => ({ sessionId, loading, error, openShell: (f) => void openShell(f) }),
    [sessionId, loading, error, openShell],
  );

  return (
    <GatewayShellContext.Provider value={value}>
      {children}
    </GatewayShellContext.Provider>
  );
}

export function useGatewayShell(): GatewayShellState {
  const ctx = useContext(GatewayShellContext);
  if (!ctx) {
    throw new Error(
      "useGatewayShell must be used inside a <GatewayShellProvider>",
    );
  }
  return ctx;
}

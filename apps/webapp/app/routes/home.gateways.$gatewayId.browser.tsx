import { Outlet, useNavigate, useParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import {
  useSetBrowserActions,
  type BrowserProfileItem,
  type BrowserSessionItem,
} from "~/components/browser/browser-actions-context";
import { useGateway } from "~/components/gateway/gateway-provider";

export interface GatewayBrowserOutletContext {
  sessions: BrowserSessionItem[] | null;
  profiles: BrowserProfileItem[];
  loadError: string | null;
  refresh: () => void;
}

/**
 * Layout for the per-gateway Browser tab. Owns the session list, registers
 * the PageHeader popover (sessions + create), and renders the active
 * session view via `<Outlet>`. Selection is URL-driven — child routes match
 * `:sessionName`, and clicking a session in the popover navigates there.
 */
export default function GatewayBrowserLayout() {
  const gw = useGateway();
  const params = useParams();
  const navigate = useNavigate();
  const setBrowserActions = useSetBrowserActions();

  const selectedName = (params.sessionName as string | undefined) ?? null;

  const [sessions, setSessions] = useState<BrowserSessionItem[] | null>(null);
  const [profiles, setProfiles] = useState<BrowserProfileItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/v1/gateways/${gw.id}/browser-sessions`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `failed (${res.status})`);
      }
      const body = (await res.json()) as {
        sessions: BrowserSessionItem[];
        profiles: BrowserProfileItem[];
      };
      setSessions(body.sessions ?? []);
      setProfiles(body.profiles ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [gw.id]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleSelect = useCallback(
    (name: string) => {
      navigate(`/home/gateways/${gw.id}/browser/${encodeURIComponent(name)}`);
    },
    [gw.id, navigate],
  );

  const handleLaunch = useCallback(
    async (name: string) => {
      setLaunching(name);
      setLaunchError(null);
      try {
        const res = await fetch(
          `/api/v1/gateways/${gw.id}/browser/launch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionName: name }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok)
          throw new Error(body.error ?? `launch failed (${res.status})`);
        handleSelect(name);
        refresh();
      } catch (err) {
        setLaunchError(err instanceof Error ? err.message : String(err));
      } finally {
        setLaunching(null);
      }
    },
    [gw.id, handleSelect, refresh],
  );

  const handleCreate = useCallback(
    async (name: string, profile: string) => {
      const res = await fetch(
        `/api/v1/gateways/${gw.id}/browser/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, profile }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `create failed (${res.status})`);
      }
      await refresh();
      handleSelect(name);
    },
    [gw.id, handleSelect, refresh],
  );

  useEffect(() => {
    setBrowserActions({
      sessions,
      profiles,
      selectedName,
      launchingName: launching,
      loadError,
      launchError,
      onSelect: handleSelect,
      onLaunch: handleLaunch,
      onCreate: handleCreate,
      onRefresh: refresh,
    });
    return () => setBrowserActions(null);
  }, [
    sessions,
    profiles,
    selectedName,
    launching,
    loadError,
    launchError,
    handleSelect,
    handleLaunch,
    handleCreate,
    refresh,
    setBrowserActions,
  ]);

  const childCtx: GatewayBrowserOutletContext = {
    sessions,
    profiles,
    loadError,
    refresh,
  };

  return <Outlet context={childCtx} />;
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLocation, useNavigate } from "@remix-run/react";

export type Tab = {
  id: string;
  path: string;
  title: string;
};

type TabsContextValue = {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (path?: string) => void;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

const STORAGE_KEY = "desktop-tabs-v1";

function getTitleFromPath(path: string): string {
  if (path === "/home" || path === "/home/") return "Home";
  if (path.startsWith("/home/daily")) return "Daily";
  if (path.startsWith("/home/conversation/")) return "Chat";
  if (path.startsWith("/home/tasks/")) return "Task";
  if (path.startsWith("/home/tasks")) return "Tasks";
  if (path.startsWith("/home/memory/graph")) return "Memory Graph";
  if (path.startsWith("/home/memory")) return "Memory";
  if (path.startsWith("/home/overview")) return "Overview";
  if (path.startsWith("/home/agent/skills")) return "Skills";
  if (path.startsWith("/home/agent/automations")) return "Automations";
  if (path.startsWith("/home/integrations")) return "Integrations";
  if (path.startsWith("/home/integration/")) return "Integration";
  return "Home";
}

function loadPersistedTabs(): { tabs: Tab[]; activeTabId: string | null } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function persistTabs(tabs: Tab[], activeTabId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch {}
}

export function DesktopTabsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Initialize from localStorage (client-only)
  useEffect(() => {
    const saved = loadPersistedTabs();
    const currentPath = location.pathname + location.search;

    if (saved && saved.tabs.length > 0) {
      // Update the active tab to current path (in case of page reload)
      const updated = saved.tabs.map((tab) =>
        tab.id === saved.activeTabId
          ? { ...tab, path: currentPath, title: getTitleFromPath(currentPath) }
          : tab,
      );
      setTabs(updated);
      setActiveTabId(saved.activeTabId);
      persistTabs(updated, saved.activeTabId);
    } else {
      const id = crypto.randomUUID();
      const initialTab: Tab = {
        id,
        path: currentPath,
        title: getTitleFromPath(currentPath),
      };
      setTabs([initialTab]);
      setActiveTabId(id);
      persistTabs([initialTab], id);
    }

    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active tab path + title on navigation
  useEffect(() => {
    if (!initialized || !activeTabId) return;
    const currentPath = location.pathname + location.search;
    const title = getTitleFromPath(location.pathname);

    setTabs((prev) => {
      const updated = prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, path: currentPath, title } : tab,
      );
      persistTabs(updated, activeTabId);
      return updated;
    });
  }, [location, initialized, activeTabId]);

  const openTab = useCallback(
    (path = "/home") => {
      const id = crypto.randomUUID();
      const newTab: Tab = { id, path, title: getTitleFromPath(path) };
      setTabs((prev) => {
        const updated = [...prev, newTab];
        persistTabs(updated, id);
        return updated;
      });
      setActiveTabId(id);
      navigate(path);
    },
    [navigate],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        // Tab not found — nothing to do
        if (idx === -1) return prev;

        const updated = prev.filter((t) => t.id !== id);

        if (updated.length === 0) {
          const newId = crypto.randomUUID();
          const newTab: Tab = { id: newId, path: "/home", title: "Home" };
          const withNew = [newTab];
          persistTabs(withNew, newId);
          setActiveTabId(newId);
          navigate("/home");
          return withNew;
        }

        if (id === activeTabId) {
          const nextTab = updated[Math.min(idx, updated.length - 1)];
          if (!nextTab) return updated;
          persistTabs(updated, nextTab.id);
          setActiveTabId(nextTab.id);
          navigate(nextTab.path);
        } else {
          persistTabs(updated, activeTabId);
        }

        return updated;
      });
    },
    [activeTabId, navigate],
  );

  const switchTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === id);
        if (!tab) return prev;
        persistTabs(prev, id);
        setActiveTabId(id);
        navigate(tab.path);
        return prev;
      });
    },
    [navigate],
  );

  if (!initialized) return <>{children}</>;

  return (
    <TabsContext.Provider value={{ tabs, activeTabId, openTab, closeTab, switchTab }}>
      {children}
    </TabsContext.Provider>
  );
}

export function useDesktopTabs() {
  return useContext(TabsContext);
}

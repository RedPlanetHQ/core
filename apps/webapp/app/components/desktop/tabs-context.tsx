import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLocation, useNavigate } from "@remix-run/react";
import {
  CalendarDays,
  MessageSquare,
  Brain,
  Library,
  LayoutDashboard,
  Plug,
  Home,
  type LucideIcon,
} from "lucide-react";
import { Task } from "~/components/icons/task";

export type Tab = {
  id: string;
  path: string;
  title: string;
  icon: LucideIcon | React.FC<{ size?: number; className?: string }>;
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

const routeMeta: Array<{
  match: (p: string) => boolean;
  title: string;
  icon: Tab["icon"];
}> = [
  { match: (p) => p === "/home" || p === "/home/", title: "Home", icon: Home },
  { match: (p) => p.startsWith("/home/daily"), title: "Daily", icon: CalendarDays },
  { match: (p) => p.startsWith("/home/conversation"), title: "Chat", icon: MessageSquare },
  { match: (p) => p.startsWith("/home/tasks/"), title: "Task", icon: Task },
  { match: (p) => p.startsWith("/home/tasks"), title: "Tasks", icon: Task },
  { match: (p) => p.startsWith("/home/memory"), title: "Memory", icon: Brain },
  { match: (p) => p.startsWith("/home/overview"), title: "Overview", icon: LayoutDashboard },
  { match: (p) => p.startsWith("/home/agent/skills"), title: "Skills", icon: Library },
  { match: (p) => p.startsWith("/home/integrations") || p.startsWith("/home/integration"), title: "Integrations", icon: Plug },
];

function getMetaFromPath(path: string): { title: string; icon: Tab["icon"] } {
  return routeMeta.find((r) => r.match(path)) ?? { title: "Home", icon: Home };
}

function getTitleFromPath(path: string): string {
  return getMetaFromPath(path).title;
}

function getIconFromPath(path: string): Tab["icon"] {
  return getMetaFromPath(path).icon;
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
          ? { ...tab, path: currentPath, title: getTitleFromPath(currentPath), icon: getIconFromPath(currentPath) }
          : { ...tab, icon: getIconFromPath(tab.path) },
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
        icon: getIconFromPath(currentPath),
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
    const icon = getIconFromPath(location.pathname);

    setTabs((prev) => {
      const updated = prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, path: currentPath, title, icon } : tab,
      );
      persistTabs(updated, activeTabId);
      return updated;
    });
  }, [location, initialized, activeTabId]);

  const openTab = useCallback(
    (path = "/home") => {
      const id = crypto.randomUUID();
      const newTab: Tab = { id, path, title: getTitleFromPath(path), icon: getIconFromPath(path) };
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
          const newTab: Tab = { id: newId, path: "/home", title: "Home", icon: Home };
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

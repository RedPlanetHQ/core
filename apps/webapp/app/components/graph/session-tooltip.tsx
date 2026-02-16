import { useEffect, useState, useRef } from "react";
import { Loader2 } from "lucide-react";

interface SessionTooltipProps {
  sessionId: string | null;
  position: { x: number; y: number } | null;
}

interface CachedSession {
  title: string | null;
  loading: boolean;
  error: boolean;
}

// Simple cache for session titles
const sessionCache = new Map<string, CachedSession>();

export function SessionTooltip({ sessionId, position }: SessionTooltipProps) {
  const [session, setSession] = useState<CachedSession | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    // Check cache first
    if (sessionCache.has(sessionId)) {
      setSession(sessionCache.get(sessionId)!);
      return;
    }

    // Set loading state
    const loadingState: CachedSession = { title: null, loading: true, error: false };
    setSession(loadingState);

    const fetchTitle = async () => {
      try {
        const response = await fetch(`/api/v1/documents/session/${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          const cached: CachedSession = {
            title: data.title || "Untitled Session",
            loading: false,
            error: false,
          };
          sessionCache.set(sessionId, cached);
          setSession(cached);
        } else {
          const cached: CachedSession = { title: null, loading: false, error: true };
          sessionCache.set(sessionId, cached);
          setSession(cached);
        }
      } catch {
        const cached: CachedSession = { title: null, loading: false, error: true };
        sessionCache.set(sessionId, cached);
        setSession(cached);
      }
    };

    fetchTitle();
  }, [sessionId]);

  if (!sessionId || !position) return null;

  // Position absolute within the graph container
  const tooltipStyle: React.CSSProperties = {
    position: "absolute",
    left: position.x + 12,
    top: position.y - 8,
    pointerEvents: "none",
  };

  return (
    <div
      ref={tooltipRef}
      style={tooltipStyle}
      className="bg-popover text-popover-foreground border rounded-md shadow-md px-3 py-2 max-w-xs"
    >
      {session?.loading ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : session?.error ? (
        <span className="text-sm text-muted-foreground">Unable to load</span>
      ) : (
        <span className="text-sm font-medium line-clamp-2">
          {session?.title || "Untitled Session"}
        </span>
      )}
    </div>
  );
}

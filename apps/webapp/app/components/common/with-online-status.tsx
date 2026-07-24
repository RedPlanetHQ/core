import React from "react";
import { WifiOff } from "lucide-react";
import { cn } from "~/lib/utils";

const BACK_ONLINE_MS = 2500;

type Phase = "online" | "offline" | "back";

function useOnlinePhase(): Phase {
  const [phase, setPhase] = React.useState<Phase>(() => {
    if (typeof navigator === "undefined") return "online";
    return navigator.onLine ? "online" : "offline";
  });
  const backTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const onOffline = () => {
      if (backTimerRef.current) {
        clearTimeout(backTimerRef.current);
        backTimerRef.current = null;
      }
      setPhase("offline");
    };
    const onOnline = () => {
      // Only flash "back online" if we were actually offline; ignore
      // spurious online events fired on initial mount.
      setPhase((prev) => (prev === "offline" ? "back" : prev));
      backTimerRef.current = setTimeout(() => {
        setPhase("online");
        backTimerRef.current = null;
      }, BACK_ONLINE_MS);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (backTimerRef.current) clearTimeout(backTimerRef.current);
    };
  }, []);

  return phase;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "offline" | "back";
}) {
  return (
    <div
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium",
        tone === "offline"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
      role="status"
      aria-live="polite"
    >
      <WifiOff size={12} className="shrink-0" />
      {label}
    </div>
  );
}

/**
 * HOC that swaps a component out for a small offline pill while the browser
 * is offline, flashes "Back online" for a couple of seconds when the network
 * returns, and then renders the wrapped component again. Used around the
 * ButlerStatusPill so the sidebar always has a visible network indicator and
 * the pill's own pollers don't keep firing while offline.
 */
export function withOnlineStatus<P extends object>(
  Wrapped: React.ComponentType<P>,
): React.ComponentType<P> {
  function OnlineStatusWrapped(props: P) {
    const phase = useOnlinePhase();
    if (phase === "offline")
      return <StatusPill label="No internet" tone="offline" />;
    if (phase === "back")
      return <StatusPill label="Back online" tone="back" />;
    return <Wrapped {...props} />;
  }
  OnlineStatusWrapped.displayName = `withOnlineStatus(${Wrapped.displayName ?? Wrapped.name ?? "Component"})`;
  return OnlineStatusWrapped;
}

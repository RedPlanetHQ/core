import React from "react";
import { SamAvatar } from "~/components/ui/sam-avatar";

/**
 * Full-screen "you're offline" state, used both by the Remix route
 * ErrorBoundary (when a loader/fetcher fails on a network drop) and by the
 * client-side React error boundary (when a hydration/reconnect crash tears
 * down the tree). When connectivity returns we hard-reload so Remix reruns
 * loaders and the WebSocket layer reconnects cleanly.
 *
 * Uses a distinct "bot-zen" eye pattern (closed crescents) so the UI reads
 * as "sleeping / waiting" rather than looking like the normal app.
 */
export function NoInternet({ message }: { message?: string } = {}) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => {
      // Small delay so the user sees the "back online" beat before the reload.
      setTimeout(() => window.location.reload(), 300);
    };
    // If we mount already online (e.g. React crashed while online), reload now.
    if (navigator.onLine) {
      reload();
      return;
    }
    window.addEventListener("online", reload, { once: true });
    return () => window.removeEventListener("online", reload);
  }, []);

  return (
    <div className="bg-background-2 flex h-full min-h-screen w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <SamAvatar size={120} eye="bot-zen" eyeColor="#9CA3AF" />
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-lg font-medium">You're offline</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          {message ??
            "We lost the connection. This page will refresh automatically as soon as you're back online."}
        </p>
      </div>
    </div>
  );
}

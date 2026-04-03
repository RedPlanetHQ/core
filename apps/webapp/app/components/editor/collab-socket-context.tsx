import React, { createContext, useContext, useEffect, useRef } from "react";
import { HocuspocusProviderWebsocket } from "@hocuspocus/provider";

function getCollabURL(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/collab`;
}

const CollabSocketContext = createContext<HocuspocusProviderWebsocket | null>(
  null,
);

export function CollabSocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const socketRef = useRef<HocuspocusProviderWebsocket | null>(null);

  // Guard SSR: only create the WebSocket in browser context
  if (typeof window !== "undefined" && !socketRef.current) {
    socketRef.current = new HocuspocusProviderWebsocket({
      url: getCollabURL(),
      autoConnect: true,
    });
  }

  useEffect(() => {
    return () => {
      socketRef.current?.destroy();
      socketRef.current = null;
    };
  }, []);

  return (
    <CollabSocketContext.Provider value={socketRef.current}>
      {children}
    </CollabSocketContext.Provider>
  );
}

export function useCollabSocket(): HocuspocusProviderWebsocket | null {
  return useContext(CollabSocketContext);
}

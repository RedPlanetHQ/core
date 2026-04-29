import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { api } from "./api";
import { clearPat, getPat } from "./storage";

type Me = {
  id: string;
  name: string | null;
  email: string;
  workspaceId: string;
  collabToken: string | null;
  timezone: string | null;
};

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: Me };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const pat = await getPat();
    if (!pat) {
      setState({ status: "signed-out" });
      return;
    }
    try {
      const me = await api<Me>("/api/v1/me", { method: "GET" });
      setState({ status: "signed-in", me });
    } catch {
      // Token rejected — clear and force re-login.
      await clearPat();
      setState({ status: "signed-out" });
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearPat();
    setState({ status: "signed-out" });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

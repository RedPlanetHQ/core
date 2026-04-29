import * as WebBrowser from "expo-web-browser";

import { API_URL } from "./config";
import { api } from "./api";
import { setPat } from "./storage";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const SOURCE = "core-mobile";
const CLIENT_NAME = "CORE Mobile";

type AuthorizationCodeResponse = { authorizationCode: string };
type TokenResponse = { token?: { token: string } };

// Mirrors the macOS Tauri device-code flow:
// 1. Ask the server for an authorizationCode.
// 2. Open Safari at /agent/verify so the user can sign in via Google.
// 3. Poll /api/v1/token until the verified PAT comes back.
// 4. Persist the PAT in expo-secure-store.
export async function loginWithDeviceCode(signal?: AbortSignal): Promise<void> {
  const { authorizationCode } = await api<AuthorizationCodeResponse>(
    "/api/v1/authorization-code",
    { method: "POST", auth: false },
  );

  const base64Token = base64Encode(
    JSON.stringify({
      authorizationCode,
      source: SOURCE,
      clientName: CLIENT_NAME,
    }),
  );
  const verifyUrl = `${API_URL}/agent/verify/${base64Token}?source=${SOURCE}`;

  // Fire-and-forget: we don't await the browser session because the
  // server-side flow completes when the user signs in, and we discover
  // that via polling rather than a redirect.
  WebBrowser.openBrowserAsync(verifyUrl).catch(() => {});

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("Login cancelled");
    await sleep(POLL_INTERVAL_MS);

    const tokenData = await api<TokenResponse>("/api/v1/token", {
      method: "POST",
      auth: false,
      body: { authorizationCode },
    }).catch(() => null);

    const pat = tokenData?.token?.token;
    if (pat) {
      await setPat(pat);
      WebBrowser.dismissBrowser();
      return;
    }
  }

  throw new Error("Login timed out. Please try again.");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// React Native ships `btoa` polyfilled, but we keep this thin wrapper so
// the call site is explicit about the encoding.
function base64Encode(input: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.btoa === "function") return g.btoa(input);
  return Buffer.from(input, "utf-8").toString("base64");
}

import { Linking } from "react-native";

import { CORE_API_URL } from "./config";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Login flow mirroring apps/webapp/app/routes/login._index.tsx (the Tauri flow):
 *
 *   1. POST /api/v1/authorization-code  -> { authorizationCode }
 *   2. Open https://app.getcore.me/agent/verify/{base64Token} in Safari.
 *      The user signs in (if needed) and approves the workspace.
 *   3. Poll POST /api/v1/token { authorizationCode } every 2s for up to 5m;
 *      when the user finishes step 2, the server returns the PAT.
 *
 * Returns the PAT. Throws on timeout, abort, or transport error.
 */
export async function loginAndAwaitPat(signal?: AbortSignal): Promise<string> {
  const codeRes = await fetch(`${CORE_API_URL}/api/v1/authorization-code`, {
    method: "POST",
    signal,
  });
  if (!codeRes.ok) throw new Error(`authorization-code: ${codeRes.status}`);
  const { authorizationCode } = (await codeRes.json()) as {
    authorizationCode: string;
  };

  const base64Token = base64EncodeUtf8(
    JSON.stringify({
      authorizationCode,
      source: "core-mobile",
      clientName: "CORE Mobile",
    }),
  );
  const verifyUrl = `${CORE_API_URL}/agent/verify/${base64Token}?source=core-mobile`;

  const canOpen = await Linking.canOpenURL(verifyUrl);
  if (!canOpen) throw new Error("cannot open browser");
  await Linking.openURL(verifyUrl);

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("aborted");
    await sleep(POLL_INTERVAL_MS, signal);

    const tokenRes = await fetch(`${CORE_API_URL}/api/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorizationCode }),
      signal,
    });
    if (!tokenRes.ok) continue;

    const tokenData = (await tokenRes.json()) as {
      token?: { token?: string };
    };
    const pat = tokenData.token?.token;
    if (pat) return pat;
  }

  throw new Error("Login timed out. Please try again.");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    }
  });
}

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64EncodeUtf8(input: string): string {
  const anyGlobal = globalThis as { btoa?: (s: string) => string };
  if (typeof anyGlobal.btoa === "function") {
    return anyGlobal.btoa(unescape(encodeURIComponent(input)));
  }
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else
      bytes.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const c = i + 2 < bytes.length ? bytes[i + 2] : -1;
    out += B64_CHARS[a >> 2];
    out += B64_CHARS[((a & 0x3) << 4) | (b === -1 ? 0 : b >> 4)];
    out += b === -1 ? "=" : B64_CHARS[((b & 0xf) << 2) | (c === -1 ? 0 : c >> 6)];
    out += c === -1 ? "=" : B64_CHARS[c & 0x3f];
  }
  return out;
}

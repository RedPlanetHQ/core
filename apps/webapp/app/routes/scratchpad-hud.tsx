/**
 * Scratchpad HUD — chromeless render of today's daily page, shown in
 * the bottom-left NSPanel when the user clicks the corner pill.
 *
 * Auth flows via session cookies shared with the main window (no PAT
 * plumbing required) — same pattern as `inbox-pill`. The loader
 * resolves or creates today's `Page` in the user's timezone and hands
 * the React side a Hocuspocus collab token so multiplayer edits sync
 * with the main `/home/daily` window in real time.
 */

import { useCallback, useEffect, useMemo } from "react";
import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { X } from "lucide-react";

import { ScratchpadEmbedHost } from "~/components/editor/scratchpad-embed-host.client";
import { WidgetContext } from "~/components/editor/extensions/widget-node-extension";
import { generateCollabToken } from "~/services/collab-token.server";
import {
  findOrCreateDailyPage,
  todayUTCMidnightInTimezone,
} from "~/services/page.server";
import { requireUser, requireWorkpace } from "~/services/session.server";
import {
  getOrCreateWidgetPat,
  getWidgetOptions,
} from "~/services/widgets.server";
import { isTauri, tauriInvoke } from "~/lib/tauri.client";

export const meta: MetaFunction = () => [{ title: "Scratchpad" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request).catch(() => null);
  if (!user) return json({ error: "not signed in" }, { status: 401 });

  const workspace = await requireWorkpace(request).catch(() => null);
  if (!workspace) return json({ error: "no workspace" }, { status: 400 });

  const metadata = user.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) || "UTC";
  const todayUTC = todayUTCMidnightInTimezone(timezone);
  const workspaceId = workspace.id;

  const [todayPage, widgetOptions, widgetPat] = await Promise.all([
    findOrCreateDailyPage(workspaceId, user.id, todayUTC),
    getWidgetOptions(user.id, workspaceId).catch(() => []),
    getOrCreateWidgetPat(workspaceId, user.id).catch(() => null),
  ]);

  return typedjson({
    butlerName: workspace.name ?? "butler",
    workspaceId,
    userId: user.id,
    collabToken: generateCollabToken(workspaceId, user.id),
    todayPage: { id: todayPage.id, date: todayPage.date?.toISOString() ?? "" },
    widgetOptions,
    widgetPat,
    baseUrl: new URL(request.url).origin,
  });
};

export default function ScratchpadHudRoute() {
  const data = useTypedLoaderData<typeof loader>() as any;

  const close = useCallback(() => {
    if (!isTauri()) return;
    void tauriInvoke("scratchpad_hud_hide");
  }, []);

  // Strip host body backgrounds — the panel uses its own rounded card.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  // Esc closes the panel — a single-purpose surface should obey the
  // covenant ("Esc dismisses the floating thing").
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const widgetCtxValue = useMemo(
    () =>
      data?.widgetPat && data?.baseUrl
        ? {
            pat: data.widgetPat,
            baseUrl: data.baseUrl,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            widgetOptions: (data.widgetOptions ?? []) as any,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.widgetPat, data?.baseUrl, JSON.stringify(data?.widgetOptions ?? [])],
  );

  if (!data || data.error || !data.todayPage?.id || !data.collabToken) {
    return (
      <div className="bg-background border-border text-muted-foreground flex h-screen w-screen items-center justify-center rounded-xl border p-6 text-sm shadow-lg">
        {data?.error ?? "Unable to load scratchpad."}
      </div>
    );
  }

  const headerLabel = (() => {
    const iso = data.todayPage.date;
    if (!iso) return "Today";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "Today";
    }
  })();

  const editor = (
    <ClientOnly fallback={null}>
      {() => (
        <ScratchpadEmbedHost
          pageId={data.todayPage.id}
          collabToken={data.collabToken}
          butlerName={data.butlerName ?? "butler"}
        />
      )}
    </ClientOnly>
  );

  return (
    <div className="bg-background border-border flex h-screen w-screen flex-col overflow-hidden rounded-xl border shadow-2xl">
      <div className="border-border flex h-9 shrink-0 items-center justify-between border-b px-3">
        <div className="text-foreground text-xs font-medium">
          {headerLabel}
        </div>
        <button
          type="button"
          onClick={close}
          className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
          title="Close (Esc)"
          aria-label="Close scratchpad"
        >
          <X size={14} />
        </button>
      </div>

      <div className="scratchpad-embed flex-1 overflow-y-auto px-3 pt-2 pb-6">
        {widgetCtxValue ? (
          <WidgetContext.Provider value={widgetCtxValue}>
            {editor}
          </WidgetContext.Provider>
        ) : (
          editor
        )}
      </div>
    </div>
  );
}

/**
 * Unified Widget renderer for the Widget table.
 *
 * Two exports:
 *   - <CoreWidgetView/>     — fetches + renders WITH chrome (border, header,
 *                              engine badge). Used by the chat embed
 *                              (<core-widget slug="..." />).
 *   - <CoreWidgetContent/>  — fetches + renders WITHOUT chrome. Used by the
 *                              dashboard pin grid which has its own chrome
 *                              (drag handle + remove button).
 *
 * Both fetch `/api/v1/widgets/:id` and dispatch by `engine`:
 *   DECLARATIVE → <WidgetRuntime ir={spec} />
 *   BUNDLED     → <BundledWidgetRenderer ... />
 */

import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Box } from "lucide-react";
import type { WidgetIR } from "@core/types";
import { WidgetRuntime } from "./runtime";
import { BundledWidgetRenderer } from "./BundledWidgetRenderer";

interface BundledMeta {
  integrationSlug: string;
  integrationName: string;
  integrationIcon: string | null;
  frontendUrl: string | null;
  configSchema: Array<{
    key: string;
    label: string;
    type: "input" | "select";
    placeholder?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    default?: string;
  }>;
}

interface WidgetEnvelope {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: "DEFAULT" | "USER";
  engine: "DECLARATIVE" | "BUNDLED";
  version: number;

  // Declarative
  spec: WidgetIR | null;
  state: Record<string, unknown> | null;
  sourceSlug: string | null;

  // Bundled
  integrationAccountId: string | null;
  bundledWidgetSlug: string | null;
  configValues: Record<string, string> | null;
  bundled: BundledMeta | null;
  pat: string | null;
  baseUrl: string | null;
}

interface FetchState {
  status: "loading" | "ok" | "error";
  widget?: WidgetEnvelope;
  error?: string;
}

interface CommonProps {
  widgetRef: string;
  /**
   * Inline config overrides — for DECLARATIVE widgets, takes priority over
   * IR config[].default; for BUNDLED widgets, merged on top of stored
   * configValues (override wins per key).
   */
  configOverride?: Record<string, unknown>;
}

// ─── Hook: fetch the widget envelope ────────────────────────────────────────

function useWidgetFetch(widgetRef: string): FetchState {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setFetchState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/widgets/${encodeURIComponent(widgetRef)}`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) {
          const body = await res.text();
          if (!cancelled) {
            setFetchState({
              status: "error",
              error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
            });
          }
          return;
        }
        const data = (await res.json()) as { widget: WidgetEnvelope };
        if (!cancelled) {
          setFetchState({ status: "ok", widget: data.widget });
        }
      } catch (err) {
        if (!cancelled) {
          setFetchState({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetRef]);

  return fetchState;
}

// ─── CoreWidgetView (with chrome) ───────────────────────────────────────────

export function CoreWidgetView({ widgetRef, configOverride }: CommonProps) {
  const fetchState = useWidgetFetch(widgetRef);

  if (fetchState.status === "loading") {
    return (
      <div className="my-2 flex h-24 items-center justify-center rounded-lg border border-border bg-grayAlpha-50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (fetchState.status === "error" || !fetchState.widget) {
    return (
      <div className="my-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Widget unavailable</div>
          <div className="text-xs opacity-80">
            {fetchState.error ?? "unknown error"}
          </div>
        </div>
      </div>
    );
  }

  return <WidgetFrame widget={fetchState.widget} configOverride={configOverride} />;
}

// ─── CoreWidgetContent (no chrome) ──────────────────────────────────────────

/**
 * Fetches and renders a widget WITHOUT the outer frame. Use this when the
 * surface (e.g. dashboard pin grid) provides its own chrome.
 */
export function CoreWidgetContent({ widgetRef, configOverride }: CommonProps) {
  const fetchState = useWidgetFetch(widgetRef);

  if (fetchState.status === "loading") {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (fetchState.status === "error" || !fetchState.widget) {
    return (
      <div className="flex items-start gap-2 p-3 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{fetchState.error ?? "Widget unavailable"}</span>
      </div>
    );
  }

  return <WidgetBody widget={fetchState.widget} configOverride={configOverride} />;
}

// ─── Frame chrome ───────────────────────────────────────────────────────────

function WidgetFrame({
  widget,
  configOverride,
}: {
  widget: WidgetEnvelope;
  configOverride?: Record<string, unknown>;
}) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-grayAlpha-50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Box className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{widget.name}</span>
          <span className="opacity-60">·</span>
          <span className="opacity-60">{widget.slug}</span>
          <span
            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              widget.engine === "BUNDLED"
                ? "bg-purple-500/10 text-purple-600"
                : "bg-green-500/10 text-green-600"
            }`}
          >
            {widget.engine === "BUNDLED" ? "bundled" : "ir"}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">v{widget.version}</div>
      </div>

      <div className="p-3">
        <WidgetBody widget={widget} configOverride={configOverride} />
      </div>
    </div>
  );
}

// ─── Engine dispatch (the actual content) ───────────────────────────────────

function WidgetBody({
  widget,
  configOverride,
}: {
  widget: WidgetEnvelope;
  configOverride?: Record<string, unknown>;
}) {
  if (widget.engine === "DECLARATIVE") {
    if (!widget.spec) {
      return (
        <p className="text-xs text-destructive">
          Declarative widget has no spec — data corruption.
        </p>
      );
    }
    const onStatePersist = (state: Record<string, unknown>) => {
      // Diagnostic — turn on to verify saves are firing.
      if (typeof console !== "undefined") {
        console.debug(
          `[widget-runtime] persisting state for "${widget.slug}":`,
          state,
        );
      }
      void fetch(`/api/v1/widgets/${encodeURIComponent(widget.id)}/state`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }).then((res) => {
        if (!res.ok && typeof console !== "undefined") {
          console.warn(
            `[widget-runtime] persist failed for "${widget.slug}" — HTTP ${res.status}`,
          );
        }
      });
    };

    return (
      <WidgetRuntime
        ir={widget.spec}
        widgetUuid={widget.id}
        initialState={widget.state ?? undefined}
        initialConfig={configOverride}
        onStatePersist={onStatePersist}
      />
    );
  }

  // BUNDLED
  if (
    !widget.bundled ||
    !widget.bundled.frontendUrl ||
    !widget.integrationAccountId ||
    !widget.bundledWidgetSlug ||
    !widget.pat ||
    !widget.baseUrl
  ) {
    return (
      <p className="text-xs text-destructive">
        Bundled widget missing required fields (integration disconnected, or
        bundle not deployed).
      </p>
    );
  }

  const mergedConfig: Record<string, string> = {
    ...(widget.configValues ?? {}),
  };
  if (configOverride) {
    for (const [k, v] of Object.entries(configOverride)) {
      mergedConfig[k] = v == null ? "" : String(v);
    }
  }

  return (
    <BundledWidgetRenderer
      bundledWidgetSlug={widget.bundledWidgetSlug}
      frontendUrl={widget.bundled.frontendUrl}
      integrationAccountId={widget.integrationAccountId}
      integrationSlug={widget.bundled.integrationSlug}
      integrationName={widget.bundled.integrationName}
      pat={widget.pat}
      baseUrl={widget.baseUrl}
      configValues={mergedConfig}
    />
  );
}

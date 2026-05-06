/**
 * CoreWidgetView — unified chat-side renderer for the Widget table.
 *
 * Fetches by slug or uuid, then dispatches based on `engine`:
 *   DECLARATIVE → <WidgetRuntime ir={spec} />
 *   BUNDLED     → <BundledWidgetRenderer ... />
 *
 * One tag (`<core-widget slug="..." />`), one entry point, one fetch.
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

export function CoreWidgetView({
  widgetRef,
  configOverride,
}: {
  widgetRef: string;
  /**
   * Inline config from the embed tag — overrides per-key on top of the
   * row's stored config (BUNDLED) or the IR's config[].default (DECLARATIVE).
   */
  configOverride?: Record<string, unknown>;
}) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
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

  return (
    <WidgetFrame
      widget={fetchState.widget}
      configOverride={configOverride}
    />
  );
}

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
          {widget.kind === "DEFAULT" && (
            <span className="ml-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-600">
              default
            </span>
          )}
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
    const onStatePersist =
      widget.kind === "USER"
        ? (state: Record<string, unknown>) => {
            void fetch(`/api/v1/widgets/${encodeURIComponent(widget.id)}/state`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ state }),
            });
          }
        : undefined;

    // Inline config overrides take precedence over IR config[].default.
    return (
      <WidgetRuntime
        ir={widget.spec}
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

  // Merge: stored row config + per-embed override (override wins per key).
  // Bundled widgets' configSchema is string-typed (input | select), so we
  // coerce override values to strings here. Declarative widgets keep richer
  // types via WidgetRuntime.initialConfig.
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

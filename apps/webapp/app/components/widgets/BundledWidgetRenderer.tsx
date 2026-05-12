/**
 * BundledWidgetRenderer — mounts a vendor-shipped (github/spotify/etc.)
 * widget bundle.
 *
 * Loads the integration's compiled `frontendUrl`, finds the widget by
 * `bundledWidgetSlug`, calls its `render(ctx)` with the workspace's widget
 * PAT and the user's connected account, and mounts the returned React
 * component.
 *
 * Mirrors the rendering logic that previously lived in
 * `apps/webapp/app/components/editor/extensions/widget-node-extension.tsx`,
 * extracted here so the unified `CoreWidgetView` can dispatch BUNDLED rows
 * to it without duplicating bundle-loading code.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadWidgetBundle } from "~/utils/widget-loader.client";

type WidgetComponent = React.ComponentType<Record<string, unknown>>;

export interface BundledWidgetProps {
  bundledWidgetSlug: string;
  frontendUrl: string;
  integrationAccountId: string;
  integrationSlug: string;
  integrationName: string;
  pat: string;
  baseUrl: string;
  configValues: Record<string, string>;
}

export function BundledWidgetRenderer({
  bundledWidgetSlug,
  frontendUrl,
  integrationAccountId,
  integrationSlug,
  integrationName,
  pat,
  baseUrl,
  configValues,
}: BundledWidgetProps) {
  const [Component, setComponent] = useState<WidgetComponent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComponent(null);
    setError(null);

    (async () => {
      try {
        const { widgets } = await loadWidgetBundle(frontendUrl);
        if (cancelled) return;
        const widget = widgets.find((w) => w.slug === bundledWidgetSlug);
        if (!widget) {
          if (!cancelled) {
            setError(`Widget "${bundledWidgetSlug}" not found in bundle`);
          }
          return;
        }
        const ctx = {
          placement: "webapp" as const,
          pat,
          accounts: [
            {
              id: integrationAccountId,
              slug: integrationSlug,
              name: integrationName,
            },
          ],
          baseUrl,
          config: configValues,
        };
        const Comp = await widget.render(ctx);
        if (!cancelled) {
          setComponent(() => Comp as WidgetComponent);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    frontendUrl,
    bundledWidgetSlug,
    pat,
    baseUrl,
    integrationAccountId,
    integrationSlug,
    integrationName,
    JSON.stringify(configValues),
  ]);

  if (error) {
    return <p className="p-3 text-xs text-destructive">{error}</p>;
  }
  if (!Component) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <Component />;
}

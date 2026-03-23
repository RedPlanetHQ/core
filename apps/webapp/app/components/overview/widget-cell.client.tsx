import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loadWidgetBundle } from "~/utils/widget-loader.client";

interface WidgetCellProps {
  widgetSlug: string;
  widgetUrl: string;
  integrationAccountId: string;
  integrationSlug: string;
  integrationName: string;
  pat: string;
  baseUrl: string;
}

type WidgetComponent = React.ComponentType<Record<string, unknown>>;

export function WidgetCell({
  widgetSlug,
  widgetUrl,
  integrationAccountId,
  integrationSlug,
  integrationName,
  pat,
  baseUrl,
}: WidgetCellProps) {
  const [Component, setComponent] = useState<WidgetComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    (async () => {
      try {
        const mod = await loadWidgetBundle(widgetUrl);
        const widgets = mod.widgets as Array<{
          slug: string;
          render: (ctx: unknown) => Promise<WidgetComponent> | WidgetComponent;
        }>;

        const widget = widgets.find((w) => w.slug === widgetSlug);
        if (!widget) {
          setError(`Widget "${widgetSlug}" not found in bundle`);
          return;
        }

        const ctx = {
          placement: "webapp" as const,
          pat,
          accounts: [{ id: integrationAccountId, slug: integrationSlug, name: integrationName }],
          baseUrl,
        };

        const Comp = await widget.render(ctx);
        setComponent(() => Comp as WidgetComponent);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [widgetUrl, widgetSlug, pat, baseUrl, integrationAccountId, integrationSlug, integrationName]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-destructive text-xs">{error}</p>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <Component />;
}

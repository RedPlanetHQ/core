import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Settings, X, Loader2 } from "lucide-react";
import type { WidgetConfigField } from "@redplanethq/types";
import { loadWidgetBundle } from "~/utils/widget-loader.client";
import type { WidgetOption } from "~/components/overview/types";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface WidgetContextValue {
  pat: string;
  baseUrl: string;
  widgetOptions: WidgetOption[];
}

export const WidgetContext = createContext<WidgetContextValue | null>(null);

// ─── Config form ─────────────────────────────────────────────────────────────

function WidgetConfigForm({
  schema,
  initialConfig,
  onSubmit,
  onCancel,
}: {
  schema: WidgetConfigField[];
  initialConfig: Record<string, string>;
  onSubmit: (config: Record<string, string>) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      schema.map((f) => [f.key, initialConfig[f.key] ?? f.default ?? ""]),
    ),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      {schema.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-xs font-medium">
            {field.label}
            {field.required && (
              <span className="text-destructive ml-0.5">*</span>
            )}
          </label>
          {field.type === "select" ? (
            <select
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select…</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              placeholder={field.placeholder}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>
      ))}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Load Widget
        </button>
      </div>
    </form>
  );
}

// ─── Widget renderer ─────────────────────────────────────────────────────────

type WidgetComponent = React.ComponentType<Record<string, unknown>>;

function WidgetRenderer({
  widgetSlug,
  frontendUrl,
  integrationAccountId,
  integrationSlug,
  integrationName,
  pat,
  baseUrl,
  config,
}: {
  widgetSlug: string;
  frontendUrl: string;
  integrationAccountId: string;
  integrationSlug: string;
  integrationName: string;
  pat: string;
  baseUrl: string;
  config: Record<string, string>;
}) {
  const [Component, setComponent] = useState<WidgetComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const { widgets } = await loadWidgetBundle(frontendUrl);
        const widget = widgets.find((w) => w.slug === widgetSlug);
        if (!widget) {
          setError(`Widget "${widgetSlug}" not found in bundle`);
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
          config,
        };
        const Comp = await widget.render(ctx);
        setComponent(() => Comp as WidgetComponent);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [
    frontendUrl,
    widgetSlug,
    pat,
    baseUrl,
    integrationAccountId,
    integrationSlug,
    integrationName,
  ]);

  if (error) {
    return <p className="p-4 text-xs text-destructive">{error}</p>;
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

// ─── NodeView component ───────────────────────────────────────────────────────

function WidgetNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const ctx = useContext(WidgetContext);

  const { widgetSlug, integrationAccountId, config: configStr } = node.attrs as {
    widgetSlug: string;
    integrationAccountId: string;
    config: string | null;
  };

  // Derive everything else from widgetOptions
  const opt = ctx?.widgetOptions.find(
    (w) => w.widgetSlug === widgetSlug && w.integrationAccountId === integrationAccountId,
  );

  const configSchema: WidgetConfigField[] = opt?.configSchema ?? [];
  const config: Record<string, string> | null = configStr ? JSON.parse(configStr) : null;
  const hasSchema = configSchema.length > 0;

  const [editing, setEditing] = useState(!config && hasSchema);

  const handleConfigSubmit = useCallback(
    (values: Record<string, string>) => {
      updateAttributes({ config: JSON.stringify(values) });
      setEditing(false);
    },
    [updateAttributes],
  );

  const showForm = editing || (!config && hasSchema);

  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-grayAlpha-50 px-3 py-2 select-none">
        <span className="text-xs text-muted-foreground">
          {opt?.widgetName ?? widgetSlug} · {opt?.integrationName ?? ""}
        </span>
        <div className="flex items-center gap-1">
          {hasSchema && (
            <button
              onClick={() => setEditing((e) => !e)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              title="Edit config"
            >
              <Settings size={13} />
            </button>
          )}
          <button
            onClick={deleteNode}
            className="text-muted-foreground transition-colors hover:text-foreground"
            title="Remove widget"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body — select-text overrides TipTap's contenteditable="false" user-select:none */}
      <div className="select-text overflow-auto">
        {showForm ? (
          <WidgetConfigForm
            schema={configSchema}
            initialConfig={config ?? {}}
            onSubmit={handleConfigSubmit}
            onCancel={hasSchema && config ? () => setEditing(false) : undefined}
          />
        ) : ctx && opt ? (
          <WidgetRenderer
            key={configStr ?? "no-config"}
            widgetSlug={widgetSlug}
            frontendUrl={opt.frontendUrl}
            integrationAccountId={integrationAccountId}
            integrationSlug={opt.integrationSlug}
            integrationName={opt.integrationName}
            pat={ctx.pat}
            baseUrl={ctx.baseUrl}
            config={config ?? {}}
          />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Widget not available
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ─── TipTap Node ──────────────────────────────────────────────────────────────

export const WidgetNode = Node.create({
  name: "widget",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      widgetSlug: { default: null },
      integrationAccountId: { default: null },
      config: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "widget" }];
  },

  renderHTML({ node }) {
    return [
      "widget",
      {
        widgetSlug: node.attrs.widgetSlug ?? "",
        integrationAccountId: node.attrs.integrationAccountId ?? "",
        config: node.attrs.config ?? "",
      },
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WidgetNodeView, { stopEvent: () => true });
  },
});

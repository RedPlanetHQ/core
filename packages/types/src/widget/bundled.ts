/**
 * Types for **bundled-integration widgets** — widgets shipped as compiled TS
 * bundles by integrations (github, spotify, metabase, etc.).
 *
 * The integration registers a `WidgetSpec` whose `render()` returns a React
 * (webapp) or pi-tui (tui) component. The runtime injects auth + accounts via
 * a closure-bound context.
 *
 * For the **declarative-IR widget** path (no bundle, JSON spec), see `./ir`.
 */

/** A single config field declared by a widget. */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: "input" | "select";
  placeholder?: string;
  required?: boolean;
  /** Options for select fields only. */
  options?: Array<{ label: string; value: string }>;
  default?: string;
}

export interface WidgetRenderContext {
  placement: "tui" | "webapp";
  pat: string;
  accounts: Array<{ id: string; slug: string; name?: string }>;
  baseUrl: string;
  /** Config values supplied by the agent or by the user via the config form. */
  config?: Record<string, string>;
  /** Call to trigger a TUI re-render after updating internal state (TUI only). */
  requestRender?: () => void;
}

/** Metadata only — used in integration Spec (no render function). */
export interface WidgetMeta {
  name: string;
  slug: string;
  description: string;
  support: Array<"tui" | "webapp">;
  tuiPlacement?: "overview" | "below-input";
  /** Declares config fields the widget accepts; drives the config form when agent omits them. */
  configSchema?: WidgetConfigField[];
}

/**
 * A zero-argument React function component (webapp placement).
 * Context (pat, accountId, baseUrl) is baked in via closure.
 */
export type WebWidgetComponent = () => unknown;

/**
 * A pi-tui Component instance (tui placement).
 * Returned by createPlayer / createList / etc. from @redplanethq/ui/tui.
 */
export type TuiWidgetComponent = object;

/** Union of the two surface-specific component types. */
export type WidgetComponent = WebWidgetComponent | TuiWidgetComponent;

/** Full widget — used in widgets/index.ts (includes render). */
export interface WidgetSpec extends WidgetMeta {
  render(context: WidgetRenderContext): Promise<WidgetComponent>;
}

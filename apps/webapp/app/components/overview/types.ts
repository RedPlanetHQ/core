import type { WidgetConfigField } from "@core/types";

export interface OverviewCell {
  id: string;
  x: number;
  y: number;
  w: number; // 1–3 columns
  h: number; // row-height units

  /**
   * For native widgets (e.g. "needs-attention"), set widgetSlug to the
   * native id. integrationSlug/integrationAccountId/widgetId are null.
   *
   * For widgets backed by the unified Widget table, set `widgetId`. The
   * integration metadata is resolved server-side from the row.
   *
   * Legacy cells may carry the old (widgetSlug, integrationSlug,
   * integrationAccountId, config) shape with no widgetId — these are
   * backward-compatible: the loader maps them to a Widget row by
   * (integrationAccountId, widgetSlug) at fetch time.
   */
  widgetSlug: string | null;
  integrationSlug: string | null;
  integrationAccountId: string | null;
  config: Record<string, string> | null;

  /** Reference to a Widget row. Preferred over the legacy fields above. */
  widgetId: string | null;
}

/** A single renderable widget option available to the user (legacy shape, kept for picker UI). */
export interface WidgetOption {
  widgetSlug: string;
  widgetName: string;
  widgetDescription: string;
  integrationSlug: string;
  integrationName: string;
  integrationIcon: string | null;
  frontendUrl: string;
  integrationAccountId: string;
  configSchema: WidgetConfigField[];

  /** When sourced from the Widget table, the row id. Picker uses this for new pins. */
  widgetId?: string;
}

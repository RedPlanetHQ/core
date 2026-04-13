import type { WidgetConfigField } from "@redplanethq/types";

export interface OverviewCell {
  id: string;
  x: number;
  y: number;
  w: number; // 1–3 columns
  h: number; // row-height units
  widgetSlug: string | null;
  integrationSlug: string | null;
  integrationAccountId: string | null;
  config: Record<string, string> | null;
}

/** A single renderable widget option available to the user */
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
}

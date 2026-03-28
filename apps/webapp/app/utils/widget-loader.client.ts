import { loadBundle } from "./bundle-loader.client";

export interface WidgetDefinition {
  slug: string;
  render: (ctx: Record<string, unknown>) => Promise<unknown>;
}

export interface WidgetBundle {
  widgets: WidgetDefinition[];
}

export async function loadWidgetBundle(
  frontendUrl: string,
): Promise<WidgetBundle> {
  const mod = await loadBundle(frontendUrl);
  return { widgets: (mod.widgets as WidgetDefinition[]) ?? [] };
}

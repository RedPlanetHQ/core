import type { ComponentType } from "react";
import { GatewayFileWidget } from "~/components/file-viewers";

/**
 * Client-side map of widget id → React component. Mirrors the
 * server-side registry in `./registry.server.ts` — every id listed
 * there must have an entry here. Components receive their props as
 * a plain object parsed from the `properties` JSON attribute on the
 * `<widget>` tag.
 *
 * Components should treat their props as untrusted (the agent
 * supplies them, the parser is permissive). Validate inside the
 * component — silently rendering with garbage values is worse than
 * rendering a small "invalid props" notice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_COMPONENTS: Record<string, ComponentType<any>> = {
  "gateway-file-viewer": GatewayFileWidget,
};

export function getWidgetComponent(
  id: string,
): ComponentType<Record<string, unknown>> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (WIDGET_COMPONENTS[id] as ComponentType<any>) ?? null;
}

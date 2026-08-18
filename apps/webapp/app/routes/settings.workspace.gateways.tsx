import { type MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";

export const meta: MetaFunction = () => [{ title: "Gateways" }];

/**
 * `/settings/workspace/gateways` — layout wrapper. The index route
 * (`settings.workspace.gateways._index.tsx`) is the gateway list; per-
 * gateway pages (files / terminal / browser) live under
 * `settings.workspace.gateways.$gatewayId.*`.
 *
 * Historically these lived at `/home/gateways/...`; they moved under
 * settings so gateway management is grouped with other workspace
 * settings (integrations, channels, models, etc.).
 */
export default function GatewaysLayout() {
  return <Outlet />;
}

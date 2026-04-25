import { type MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";

export const meta: MetaFunction = () => [{ title: "Gateways" }];

/**
 * /home/gateways — top-level layout. Just renders children. The per-gateway
 * route (`home.gateways.$gatewayId.tsx`) is the one that draws the actual
 * page header + tabs.
 */
export default function GatewaysLayout() {
  return <Outlet />;
}

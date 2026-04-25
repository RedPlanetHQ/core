import { Globe } from "lucide-react";
import { useOutletContext } from "@remix-run/react";
import type { GatewayBrowserOutletContext } from "./home.gateways.$gatewayId.browser";

/**
 * Empty state for `/home/gateways/:gatewayId/browser` — no session selected.
 */
export default function GatewayBrowserIndex() {
  const ctx = useOutletContext<GatewayBrowserOutletContext>();
  const hasSessions = (ctx.sessions?.length ?? 0) > 0;

  return (
    <div className="bg-background-2 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 px-8 text-center text-sm">
      <Globe className="h-8 w-8" />
      <p>
        {hasSessions
          ? "Open Sessions in the header to pick a browser session."
          : "No sessions yet — open Sessions in the header and click Create."}
      </p>
    </div>
  );
}

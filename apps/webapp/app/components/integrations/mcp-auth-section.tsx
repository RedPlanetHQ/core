import React, { useCallback, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Check } from "lucide-react";

interface MCPAuthSectionProps {
  integration: {
    id: string;
    name: string;
    slug: string;
  };
  activeAccount?: {
    id: string;
    integrationConfiguration?: {
      mcp?: any;
    };
  };
  hasMCPAuth: boolean;
}

export function MCPAuthSection({
  integration,
  activeAccount,
  hasMCPAuth,
}: MCPAuthSectionProps) {
  const [isMCPConnecting, setIsMCPConnecting] = useState(false);
  const mcpFetcher = useFetcher<{ redirectURL: string }>();
  const disconnectMcpFetcher = useFetcher();

  const isMCPConnected = !!activeAccount?.integrationConfiguration?.mcp;
  const isConnected = !!activeAccount;

  const handleMCPConnect = useCallback(() => {
    setIsMCPConnecting(true);
    mcpFetcher.submit(
      {
        integrationDefinitionId: integration.id,
        redirectURL: window.location.href,
        integrationAccountId: activeAccount?.id as string,
        mcp: true,
      },
      {
        method: "post",
        action: "/api/v1/oauth",
        encType: "application/json",
      },
    );
  }, [integration.id, mcpFetcher, activeAccount?.id]);

  const handleMCPDisconnect = useCallback(() => {
    if (!activeAccount?.id) return;

    disconnectMcpFetcher.submit(
      {
        integrationAccountId: activeAccount.id,
      },
      {
        method: "post",
        action: "/api/v1/integration_account/disconnect_mcp",
        encType: "application/json",
      },
    );
  }, [activeAccount?.id, disconnectMcpFetcher]);

  // Watch for fetcher completion
  React.useEffect(() => {
    if (mcpFetcher.state === "idle" && isMCPConnecting) {
      if (mcpFetcher.data?.redirectURL) {
        window.location.href = mcpFetcher.data.redirectURL;
      } else {
        setIsMCPConnecting(false);
      }
    }
  }, [mcpFetcher.state, mcpFetcher.data, isMCPConnecting]);

  React.useEffect(() => {
    if (disconnectMcpFetcher.state === "idle" && disconnectMcpFetcher.data) {
      window.location.reload();
    }
  }, [disconnectMcpFetcher.state, disconnectMcpFetcher.data]);

  // Show nothing if not connected at all
  if (!isConnected || !hasMCPAuth) return null;

  // Show MCP box if:
  // - hasMCPAuth is true (always show MCP section)
  // - OR hasMCPAuth is false but integration is connected (show MCP URL box only)
  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-lg font-medium">MCP Authentication</h3>

      {hasMCPAuth &&
        (isMCPConnected ? (
          <div className="bg-background-3 rounded-lg p-4">
            <div className="text-sm">
              <p className="inline-flex items-center gap-2 font-medium">
                <Check size={16} /> MCP Connected
              </p>
              <p className="text-muted-foreground mb-3">
                MCP (Model Context Protocol) authentication is active
              </p>
              <div className="flex w-full justify-end">
                <Button
                  variant="destructive"
                  disabled={disconnectMcpFetcher.state === "submitting"}
                  onClick={handleMCPDisconnect}
                >
                  {disconnectMcpFetcher.state === "submitting"
                    ? "Disconnecting..."
                    : "Disconnect"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-background-3 rounded-lg p-4">
            <h4 className="text-md mb-1 font-medium">
              MCP (Model Context Protocol) Authentication
            </h4>
            <p className="text-muted-foreground mb-3 text-sm">
              This integration requires MCP (Model Context Protocol)
              authentication. Please provide the required MCP credentials in
              addition to any other authentication method.
            </p>

            <div className="flex w-full justify-end">
              <Button
                variant="secondary"
                disabled={isMCPConnecting || mcpFetcher.state === "submitting"}
                onClick={handleMCPConnect}
              >
                {isMCPConnecting || mcpFetcher.state === "submitting"
                  ? "Connecting..."
                  : `Connect for MCP`}
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}

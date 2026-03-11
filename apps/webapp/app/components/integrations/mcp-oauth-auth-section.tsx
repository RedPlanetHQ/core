import React, { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";

interface McpOAuthAuthSectionProps {
  integration: {
    id: string;
    name: string;
  };
  activeAccount: any;
}

export function McpOAuthAuthSection({
  integration,
  activeAccount,
}: McpOAuthAuthSectionProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const fetcher = useFetcher<{ success: boolean; redirectURL?: string }>();

  const handleConnect = useCallback(() => {
    setIsConnecting(true);
    fetcher.submit(
      {
        integrationDefinitionId: integration.id,
        redirectURL: window.location.href,
      },
      {
        method: "post",
        action: "/api/v1/oauth/mcp-integration",
      },
    );
  }, [integration.id, fetcher]);

  React.useEffect(() => {
    if (fetcher.state === "idle" && isConnecting) {
      if (fetcher.data?.redirectURL) {
        window.location.href = fetcher.data.redirectURL;
      } else {
        setIsConnecting(false);
      }
    }
  }, [fetcher.state, fetcher.data, isConnecting]);

  if (activeAccount) {
    return null;
  }

  return (
    <div className="bg-background-3 rounded-lg p-4">
      <h4 className="mb-3 font-medium">MCP OAuth Authentication</h4>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={isConnecting || fetcher.state === "submitting"}
        onClick={handleConnect}
        className="w-full"
      >
        {isConnecting || fetcher.state === "submitting"
          ? "Connecting..."
          : `Connect to ${integration.name}`}
      </Button>
    </div>
  );
}

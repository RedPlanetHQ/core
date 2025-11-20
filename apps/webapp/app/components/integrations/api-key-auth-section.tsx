import React, { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface ApiKeyAuthSectionProps {
  integration: {
    id: string;
    name: string;
  };
  specData: any;
  activeAccount: any;
}

export function ApiKeyAuthSection({
  integration,
  specData,
  activeAccount,
}: ApiKeyAuthSectionProps) {
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const apiKeyFetcher = useFetcher();

  const handleApiKeyConnect = useCallback(() => {
    if (!apiKey.trim()) return;

    setIsLoading(true);
    apiKeyFetcher.submit(
      {
        integrationDefinitionId: integration.id,
        apiKey,
      },
      {
        method: "post",
        action: "/api/v1/integration_account",
        encType: "application/json",
      },
    );
  }, [integration.id, apiKey, apiKeyFetcher]);

  React.useEffect(() => {
    if (apiKeyFetcher.state === "idle" && isLoading) {
      if (apiKeyFetcher.data !== undefined) {
        window.location.reload();
      }
    }
  }, [apiKeyFetcher.state, apiKeyFetcher.data, isLoading]);

  if (activeAccount || !specData?.auth?.api_key) {
    return null;
  }

  return (
    <div className="bg-background-3 space-y-4 rounded-lg p-4">
      <h4 className="font-medium">API Key Authentication</h4>
      {!showApiKeyForm ? (
        <Button
          variant="secondary"
          onClick={() => setShowApiKeyForm(true)}
          className="w-full"
        >
          Connect with API Key
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="apiKey" className="text-sm font-medium">
              {specData?.auth?.api_key?.label || "API Key"}
            </label>
            <Input
              id="apiKey"
              placeholder="Enter your API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {specData?.auth?.api_key?.description && (
              <p className="text-muted-foreground text-sm">
                {specData.auth.api_key.description}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowApiKeyForm(false);
                setApiKey("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={isLoading || !apiKey.trim()}
              onClick={handleApiKeyConnect}
            >
              {isLoading || apiKeyFetcher.state === "submitting"
                ? "Connecting..."
                : "Connect"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

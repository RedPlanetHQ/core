import React, { useState, useCallback, useMemo } from "react";
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
  const apiKeySpec = specData?.auth?.api_key;

  // Determine if the spec defines multiple API key fields (object type with properties)
  const isMultiField = useMemo(
    () => apiKeySpec?.type === "object" && apiKeySpec?.properties,
    [apiKeySpec],
  );

  const fieldKeys = useMemo(
    () => (isMultiField ? Object.keys(apiKeySpec.properties) : []),
    [isMultiField, apiKeySpec],
  );

  // Single-field state
  const [apiKey, setApiKey] = useState("");
  // Multi-field state: { fieldName: value }
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  const [isLoading, setIsLoading] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const apiKeyFetcher = useFetcher();

  const handleFieldChange = useCallback((field: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [field]: value }));
  }, []);

  const isFormValid = useMemo(() => {
    if (isMultiField) {
      return fieldKeys.every((key) => apiKeys[key]?.trim());
    }
    return apiKey.trim().length > 0;
  }, [isMultiField, fieldKeys, apiKeys, apiKey]);

  const handleApiKeyConnect = useCallback(() => {
    if (!isFormValid) return;

    setIsLoading(true);

    if (isMultiField) {
      apiKeyFetcher.submit(
        {
          integrationDefinitionId: integration.id,
          apiKeys,
        },
        {
          method: "post",
          action: "/api/v1/integration_account",
          encType: "application/json",
        },
      );
    } else {
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
    }
  }, [integration.id, apiKey, apiKeys, apiKeyFetcher, isMultiField, isFormValid]);

  React.useEffect(() => {
    if (apiKeyFetcher.state === "idle" && isLoading) {
      if (apiKeyFetcher.data !== undefined) {
        window.location.reload();
      }
    }
  }, [apiKeyFetcher.state, apiKeyFetcher.data, isLoading]);

  if (activeAccount || !apiKeySpec) {
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
          {isMultiField ? (
            // Render a field for each property defined in the spec
            fieldKeys.map((fieldKey) => {
              const fieldSpec = apiKeySpec.properties[fieldKey];
              return (
                <div key={fieldKey} className="flex flex-col gap-1">
                  <label
                    htmlFor={`apiKey-${fieldKey}`}
                    className="text-sm font-medium"
                  >
                    {fieldSpec?.label || fieldKey}
                  </label>
                  <Input
                    id={`apiKey-${fieldKey}`}
                    type="password"
                    placeholder={fieldSpec?.label || `Enter ${fieldKey}`}
                    value={apiKeys[fieldKey] || ""}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                  />
                  {fieldSpec?.description && (
                    <p className="text-muted-foreground text-sm">
                      {fieldSpec.description}
                    </p>
                  )}
                </div>
              );
            })
          ) : (
            // Single API key field (original behavior)
            <div className="flex flex-col gap-1">
              <label htmlFor="apiKey" className="text-sm font-medium">
                {apiKeySpec?.label || "API Key"}
              </label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {apiKeySpec?.description && (
                <p className="text-muted-foreground text-sm">
                  {apiKeySpec.description}
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowApiKeyForm(false);
                setApiKey("");
                setApiKeys({});
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={isLoading || !isFormValid}
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

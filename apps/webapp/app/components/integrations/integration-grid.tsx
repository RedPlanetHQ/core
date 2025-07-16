import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { IntegrationCard } from "./integration-card";

interface IntegrationGridProps {
  integrations: Array<{
    id: string;
    name: string;
    description?: string;
    icon: string;
    slug?: string;
    spec: any;
  }>;
  activeAccountIds: Set<string>;
  showDetail?: boolean;
}

export function IntegrationGrid({
  integrations,
  activeAccountIds,
}: IntegrationGridProps) {
  const hasActiveAccount = (integrationDefinitionId: string) =>
    activeAccountIds.has(integrationDefinitionId);

  if (integrations.length === 0) {
    return (
      <div className="mt-20 flex flex-col items-center justify-center">
        <Search className="text-muted-foreground mb-2 h-12 w-12" />
        <h3 className="text-lg font-medium">No integrations found</h3>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {integrations.map((integration) => {
        const isConnected = hasActiveAccount(integration.id);

        return (
          <IntegrationCard
            integration={integration}
            isConnected={isConnected}
          />
        );
      })}
    </div>
  );
}

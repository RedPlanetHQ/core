import { useMemo } from "react";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { IntegrationGrid } from "~/components/integrations/integration-grid";
import { PageHeader } from "~/components/common/page-header";
import { Plus } from "lucide-react";

import { PROVIDER_CONFIGS } from "~/components/onboarding/provider-config";
import { type Provider } from "~/components/onboarding/types";
import { useMcpSessions } from "~/hooks/use-mcp-sessions";
import { ProviderCard } from "~/components/integrations/provider-card";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId as string),
  ]);

  // Combine fixed integrations with dynamic ones
  const allIntegrations = [...integrationDefinitions];

  return json({
    integrationDefinitions: allIntegrations,
    integrationAccounts,
    userId,
  });
}

export default function Integrations() {
  const { integrationDefinitions, integrationAccounts } =
    useLoaderData<typeof loader>();

  const { sessions } = useMcpSessions({
    endpoint: "/api/v1/mcp/sessions",
  });

  // Get unique provider names from MCP sessions
  const connectedProviders = new Set(
    sessions
      .filter((session) => session.source)
      .map((session) => session.source!.toLowerCase()),
  );

  const activeAccountIds = useMemo(
    () =>
      new Set(
        integrationAccounts
          .filter((acc) => acc.isActive)
          .map((acc) => acc.integrationDefinitionId),
      ),
    [integrationAccounts],
  );

  const isProviderConnected = (provider: Provider): boolean => {
    return connectedProviders.has(provider.toLowerCase());
  };

  const providers = Object.values(PROVIDER_CONFIGS);

  return (
    <>
      <div className="flex h-full flex-col">
        <PageHeader
          title="Integrations"
          actions={[
            {
              label: "Request New Integration",
              icon: <Plus size={14} />,
              onClick: () =>
                window.open(
                  "https://github.com/redplanethq/core/issues/new",
                  "_blank",
                ),
              variant: "secondary",
            },
          ]}
        />
        <div className="home flex h-[calc(100vh_-_40px)] flex-col gap-6 overflow-y-auto p-4 px-5 md:h-[calc(100vh_-_56px)]">
          {/* Providers Section */}
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Providers</h2>
              <p className="text-muted-foreground text-sm">
                Connect AI providers to Core's memory system. Click on any
                provider to set up the integration.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {providers.map((provider) => {
                const isConnected = isProviderConnected(provider.id);
                return (
                  <ProviderCard isConnected={isConnected} provider={provider} />
                );
              })}
            </div>
          </div>

          {/* Integrations Section */}
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-muted-foreground text-sm">
                Connect third-party apps and services to enhance your Core
                experience.
              </p>
            </div>
            <IntegrationGrid
              integrations={integrationDefinitions}
              activeAccountIds={activeAccountIds}
            />
          </div>
        </div>
      </div>
    </>
  );
}

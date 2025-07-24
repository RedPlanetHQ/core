import React, { useMemo } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getIcon, type IconType } from "~/components/icon-utils";
import { Checkbox } from "~/components/ui/checkbox";
import { MCPAuthSection } from "~/components/integrations/mcp-auth-section";
import { ConnectedAccountSection } from "~/components/integrations/connected-account-section";
import { IngestionRuleSection } from "~/components/integrations/ingestion-rule-section";
import { ApiKeyAuthSection } from "~/components/integrations/api-key-auth-section";
import { OAuthAuthSection } from "~/components/integrations/oauth-auth-section";
import {
  getIngestionRuleBySource,
  upsertIngestionRule,
} from "~/services/ingestionRule.server";
import { Section } from "~/components/integrations/section";
import { PageHeader } from "~/components/common/page-header";
import { Plus } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const { slug } = params;

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId),
  ]);

  const integration = integrationDefinitions.find(
    (def) => def.slug === slug || def.id === slug,
  );

  if (!integration) {
    throw new Response("Integration not found", { status: 404 });
  }

  const activeAccount = integrationAccounts.find(
    (acc) => acc.integrationDefinitionId === integration.id && acc.isActive,
  );

  let ingestionRule = null;
  if (activeAccount) {
    ingestionRule = await getIngestionRuleBySource(
      activeAccount.id,
      workspace.id,
    );
  }

  return json({
    integration,
    integrationAccounts,
    userId,
    ingestionRule,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const { slug } = params;

  const formData = await request.formData();
  const ingestionRuleText = formData.get("ingestionRule") as string;

  if (!ingestionRuleText) {
    return json({ error: "Ingestion rule is required" }, { status: 400 });
  }

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId),
  ]);

  const integration = integrationDefinitions.find(
    (def) => def.slug === slug || def.id === slug,
  );

  if (!integration) {
    throw new Response("Integration not found", { status: 404 });
  }

  const activeAccount = integrationAccounts.find(
    (acc) => acc.integrationDefinitionId === integration.id && acc.isActive,
  );

  if (!activeAccount) {
    return json(
      { error: "No active integration account found" },
      { status: 400 },
    );
  }

  await upsertIngestionRule({
    text: ingestionRuleText,
    source: activeAccount.id,
    workspaceId: workspace.id,
    userId,
  });

  return json({ success: true });
}

function parseSpec(spec: any) {
  if (!spec) return {};
  if (typeof spec === "string") {
    try {
      return JSON.parse(spec);
    } catch {
      return {};
    }
  }
  return spec;
}

export default function IntegrationDetail() {
  const { integration, integrationAccounts, ingestionRule } =
    useLoaderData<typeof loader>();

  const activeAccount = useMemo(
    () =>
      integrationAccounts.find(
        (acc) => acc.integrationDefinitionId === integration.id && acc.isActive,
      ),
    [integrationAccounts, integration.id],
  );

  const specData = useMemo(
    () => parseSpec(integration.spec),
    [integration.spec],
  );
  const hasApiKey = !!specData?.auth?.api_key;
  const hasOAuth2 = !!specData?.auth?.OAuth2;
  const hasMCPAuth = !!(
    specData?.mcp.type === "http" && specData?.mcp.needsAuth
  );
  const Component = getIcon(integration.icon as IconType);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Integrations"
        breadcrumbs={[
          { label: "Integrations", href: "/home/integrations" },
          { label: integration?.name || "Untitled" },
        ]}
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
      <div className="flex h-[calc(100vh_-_56px)] flex-col items-center overflow-hidden p-4 px-5">
        <div className="max-w-5xl">
          <Section
            title={integration.name}
            description={integration.description}
            icon={
              <div className="bg-grayAlpha-100 flex h-12 w-12 items-center justify-center rounded">
                <Component size={24} />
              </div>
            }
          >
            <div>
              {/* Authentication Methods */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Authentication Methods</h3>
                <div className="space-y-2">
                  {hasApiKey && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <Checkbox checked /> API Key authentication
                      </span>
                    </div>
                  )}
                  {hasOAuth2 && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <Checkbox checked />
                        OAuth 2.0 authentication
                      </span>
                    </div>
                  )}
                  {!hasApiKey && !hasOAuth2 && !hasMCPAuth && (
                    <div className="text-muted-foreground text-sm">
                      No authentication method specified
                    </div>
                  )}
                </div>
              </div>

              {/* Connect Section */}
              {!activeAccount && (hasApiKey || hasOAuth2) && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-lg font-medium">
                    Connect to {integration.name}
                  </h3>

                  {/* API Key Authentication */}
                  <ApiKeyAuthSection
                    integration={integration}
                    specData={specData}
                    activeAccount={activeAccount}
                  />

                  {/* OAuth Authentication */}
                  <OAuthAuthSection
                    integration={integration}
                    specData={specData}
                    activeAccount={activeAccount}
                  />
                </div>
              )}

              {/* Connected Account Info */}
              <ConnectedAccountSection activeAccount={activeAccount} />

              {/* MCP Authentication Section */}
              <MCPAuthSection
                integration={integration}
                activeAccount={activeAccount as any}
                hasMCPAuth={hasMCPAuth}
              />

              {/* Ingestion Rule Section */}
              <IngestionRuleSection
                ingestionRule={ingestionRule}
                activeAccount={activeAccount}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

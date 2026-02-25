import { useMemo } from "react";
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
    getIntegrationDefinitions(workspace?.id),
    getIntegrationAccounts(userId, workspace?.id as string),
  ]);

  // Combine fixed integrations with dynamic ones
  const allIntegrations = integrationDefinitions;

  const integration = allIntegrations.find(
    (def) => def.slug === slug || def.id === slug,
  );

  if (!integration) {
    throw new Response("Integration not found", { status: 404 });
  }

  const activeAccounts = integrationAccounts.filter(
    (acc) => acc.integrationDefinitionId === integration.id && acc.isActive,
  );

  // Get ingestion rule for the first account (if exists)
  let ingestionRule = null;
  if (activeAccounts.length > 0) {
    ingestionRule = await getIngestionRuleBySource(
      activeAccounts[0].id,
      workspace?.id as string,
    );
  }

  return json({
    integration,
    integrationAccounts,
    activeAccounts,
    userId,
    ingestionRule,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const { slug } = params;

  if (!workspace) {
    return;
  }

  const formData = await request.formData();
  const ingestionRuleText = formData.get("ingestionRule") as string;

  if (!ingestionRuleText) {
    return json({ error: "Ingestion rule is required" }, { status: 400 });
  }

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId, workspace.id),
  ]);

  // Combine fixed integrations with dynamic ones
  const allIntegrations = integrationDefinitions;

  const integration = allIntegrations.find(
    (def) => def.slug === slug || def.id === slug,
  );

  if (!integration) {
    throw new Response("Integration not found", { status: 404 });
  }

  const activeAccounts = integrationAccounts.filter(
    (acc) => acc.integrationDefinitionId === integration.id && acc.isActive,
  );

  if (activeAccounts.length === 0) {
    return json(
      { error: "No active integration account found" },
      { status: 400 },
    );
  }

  // Apply ingestion rule to the first account (for now)
  await upsertIngestionRule({
    text: ingestionRuleText,
    source: activeAccounts[0].id,
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

interface IntegrationDetailProps {
  integration: any;
  integrationAccounts: any;
  activeAccounts: any[];
  ingestionRule: any;
}

export function IntegrationDetail({
  integration,
  integrationAccounts,
  activeAccounts,
  ingestionRule,
}: IntegrationDetailProps) {
  const hasActiveAccounts = activeAccounts && activeAccounts.length > 0;

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
      <div className="flex h-[calc(100vh)] flex-col items-center overflow-y-auto p-4 px-5 md:h-[calc(100vh_-_56px)]">
        <div className="w-full md:max-w-5xl">
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
                      <span className="inline-flex items-center gap-2">
                        <Checkbox checked /> API Key authentication
                      </span>
                    </div>
                  )}
                  {hasOAuth2 && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2">
                        <Checkbox checked />
                        OAuth 2.0 authentication
                      </span>
                    </div>
                  )}
                  {!hasApiKey && !hasOAuth2 && !hasMCPAuth && (
                    <div className="text-muted-foreground">
                      No authentication method specified
                    </div>
                  )}
                </div>
              </div>

              {/* Connect Section - Always show to allow adding more accounts */}
              {(hasApiKey || hasOAuth2) && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-lg font-medium">
                    {hasActiveAccounts
                      ? `Add Another ${integration.name} Account`
                      : `Connect to ${integration.name}`}
                  </h3>

                  {/* API Key Authentication */}
                  <ApiKeyAuthSection
                    integration={integration}
                    specData={specData}
                    activeAccount={null}
                  />

                  {/* OAuth Authentication */}
                  <OAuthAuthSection
                    integration={integration}
                    specData={specData}
                    activeAccount={null}
                  />
                </div>
              )}

              {/* Connected Accounts Info */}
              <ConnectedAccountSection activeAccounts={activeAccounts as any} />

              {/* MCP Authentication Section */}
              <MCPAuthSection
                integration={integration}
                activeAccount={hasActiveAccounts ? activeAccounts[0] : null}
                hasMCPAuth={hasMCPAuth}
              />

              {/* Ingestion Rule Section */}
              <IngestionRuleSection
                ingestionRule={ingestionRule}
                activeAccount={hasActiveAccounts ? activeAccounts[0] : null}
                slug={integration.slug}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationDetailWrapper() {
  const { integration, integrationAccounts, activeAccounts, ingestionRule } =
    useLoaderData<typeof loader>();

  return (
    <IntegrationDetail
      integration={integration}
      integrationAccounts={integrationAccounts}
      activeAccounts={activeAccounts}
      ingestionRule={ingestionRule}
    />
  );
}

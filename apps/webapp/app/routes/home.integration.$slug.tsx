import { useMemo } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { getIcon, type IconType } from "~/components/icon-utils";
import { Checkbox } from "~/components/ui/checkbox";
import { MCPAuthSection } from "~/components/integrations/mcp-auth-section";
import { ConnectedAccountSection } from "~/components/integrations/connected-account-section";
import { ApiKeyAuthSection } from "~/components/integrations/api-key-auth-section";
import { OAuthAuthSection } from "~/components/integrations/oauth-auth-section";
import { McpOAuthAuthSection } from "~/components/integrations/mcp-oauth-auth-section";
import { Section } from "~/components/integrations/section";
import { PageHeader } from "~/components/common/page-header";
import { prisma } from "~/db.server";
import { scheduler, unschedule } from "~/services/oauth/scheduler";
import { Plus } from "lucide-react";
import { isBillingEnabled, isPaidPlan } from "~/config/billing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const { slug } = params;

  const [integrationDefinitions, integrationAccounts, subscription] =
    await Promise.all([
      getIntegrationDefinitions(workspace?.id),
      getIntegrationAccounts(user.id, workspace?.id as string),
      prisma.subscription.findUnique({
        where: { workspaceId: workspace?.id },
      }),
    ]);

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

  // Auto-read is available if billing is disabled OR user has a paid plan OR user is an admin
  const isAutoReadAvailable =
    !isBillingEnabled() ||
    isPaidPlan(subscription?.planType || "FREE") ||
    user.admin;

  return json({
    integration,
    integrationAccounts,
    activeAccounts,
    userId: user.id,
    isAutoReadAvailable,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "updateAutoActivityRead") {
    const integrationAccountId = formData.get("integrationAccountId") as string;
    const value = formData.get("autoActivityRead") === "true";

    if (!integrationAccountId) {
      return json(
        { error: "integrationAccountId is required" },
        { status: 400 },
      );
    }

    if (value) {
      await scheduler({ integrationAccountId });
    } else {
      await unschedule({ integrationAccountId });
    }

    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
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
  isAutoReadAvailable: boolean;
}

export function IntegrationDetail({
  integration,
  integrationAccounts,
  activeAccounts,
  isAutoReadAvailable,
}: IntegrationDetailProps) {
  const hasActiveAccounts = activeAccounts && activeAccounts.length > 0;

  const specData = useMemo(
    () => parseSpec(integration.spec),
    [integration.spec],
  );
  const hasApiKey = !!specData?.auth?.api_key;
  const hasOAuth2 = !!specData?.auth?.OAuth2;
  const hasMcpOAuth = !!specData?.auth?.mcp;
  const hasMCPAuth = !!(
    specData?.mcp?.type === "http" && specData?.mcp?.needsAuth
  );
  const hasAutoActivity = !!specData?.schedule && !!specData?.enableAutoRead;
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
                  {hasMcpOAuth && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2">
                        <Checkbox checked />
                        MCP OAuth authentication
                      </span>
                    </div>
                  )}
                  {!hasApiKey && !hasOAuth2 && !hasMcpOAuth && !hasMCPAuth && (
                    <div className="text-muted-foreground">
                      No authentication method specified
                    </div>
                  )}
                </div>
              </div>

              {/* Connect Section - Always show to allow adding more accounts */}
              {(hasApiKey || hasOAuth2 || hasMcpOAuth) && (
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

                  {/* MCP OAuth Authentication */}
                  {hasMcpOAuth && (
                    <McpOAuthAuthSection
                      integration={integration}
                      activeAccount={
                        hasActiveAccounts ? activeAccounts[0] : null
                      }
                    />
                  )}
                </div>
              )}

              {/* Connected Accounts Info */}
              <ConnectedAccountSection
                activeAccounts={activeAccounts as any}
                isAutoReadAvailable={isAutoReadAvailable}
                supportsAutoActivity={hasAutoActivity}
              />

              {/* MCP Authentication Section */}
              <MCPAuthSection
                integration={integration}
                activeAccount={hasActiveAccounts ? activeAccounts[0] : null}
                hasMCPAuth={hasMCPAuth}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationDetailWrapper() {
  const {
    integration,
    integrationAccounts,
    activeAccounts,
    isAutoReadAvailable,
  } = useLoaderData<typeof loader>();

  return (
    <IntegrationDetail
      integration={integration}
      integrationAccounts={integrationAccounts}
      activeAccounts={activeAccounts}
      isAutoReadAvailable={isAutoReadAvailable}
    />
  );
}

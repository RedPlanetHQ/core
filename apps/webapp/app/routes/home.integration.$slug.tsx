import { useCallback, useEffect, useMemo, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
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
import { Button } from "~/components/ui/button";
import { prisma } from "~/db.server";
import { scheduler, unschedule } from "~/services/oauth/scheduler";
import { Plus } from "lucide-react";
import { isBillingEnabled, isPaidPlan } from "~/config/billing.server";
import { logger } from "~/services/logger.service";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data?.integration?.name;
  return [{ title: name ? `${name} | Integrations` : "Integrations" }];
};

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
  const user = await requireUser(request);

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

    const integrationAccount = await prisma.integrationAccount.findUnique({
      where: { id: integrationAccountId, deleted: null },
      include: {
        integrationDefinition: true,
        workspace: { include: { Subscription: true } },
      },
    });

    if (!integrationAccount) {
      return json({ error: "Integration account not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = integrationAccount.integrationDefinition.spec as any;
    const hasSchedule = !!spec?.schedule?.frequency;

    if (hasSchedule) {
      if (value) {
        await scheduler({ integrationAccountId, admin: user.admin });
      } else {
        await unschedule({ integrationAccountId });
      }

      return json({ success: true });
    }

    // Webhook-based integration: no scheduler to manage. Persist the
    // toggle directly so downstream consumers (e.g. webhook handlers)
    // can honor the user's auto-read preference.
    if (value && isBillingEnabled() && !user.admin) {
      const planType =
        integrationAccount.workspace?.Subscription?.planType || "FREE";
      if (!isPaidPlan(planType)) {
        logger.warn("Auto-read requires a paid plan", {
          workspaceId: integrationAccount.workspace?.id,
          planType,
        });
        return json(
          { error: "Auto-read requires a Pro or Max plan" },
          { status: 403 },
        );
      }
    }

    await prisma.integrationAccount.update({
      where: { id: integrationAccountId },
      data: {
        settings: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((integrationAccount.settings as any) || {}),
          autoActivityRead: value,
        },
      },
    });

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
  const hasWidgets =
    Array.isArray(specData?.widgets) && specData.widgets.length > 0;
  const isWidgetOnly =
    !hasApiKey && !hasOAuth2 && !hasMcpOAuth && !hasMCPAuth && hasWidgets;
  const hasAutoActivity = !!specData?.enableAutoRead;
  const Component = getIcon(integration.icon as IconType);

  const installFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [installError, setInstallError] = useState<string | null>(null);

  const handleWidgetInstall = useCallback(() => {
    setInstallError(null);
    installFetcher.submit(
      { integrationDefinitionId: integration.id },
      {
        method: "post",
        action: "/api/v1/integration_account",
        encType: "application/json",
      },
    );
  }, [integration.id, installFetcher]);

  useEffect(() => {
    if (installFetcher.state !== "idle" || !installFetcher.data) return;
    if (installFetcher.data.success) {
      revalidator.revalidate();
    } else if (installFetcher.data.error) {
      setInstallError(installFetcher.data.error);
    }
  }, [installFetcher.state, installFetcher.data, revalidator]);

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
      <div className="md:h-page flex h-[calc(100vh)] flex-col items-center overflow-y-auto p-4 px-5">
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
                  {isWidgetOnly && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2">
                        <Checkbox checked /> No authentication required
                      </span>
                    </div>
                  )}
                  {!hasApiKey &&
                    !hasOAuth2 &&
                    !hasMcpOAuth &&
                    !hasMCPAuth &&
                    !hasWidgets && (
                      <div className="text-muted-foreground">
                        No authentication method specified
                      </div>
                    )}
                </div>
              </div>

              {/* Connect Section - Always show to allow adding more accounts */}
              {(hasApiKey || hasOAuth2 || hasMcpOAuth || isWidgetOnly) &&
                !(isWidgetOnly && hasActiveAccounts) && (
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

                    {/* Widget-only install — same Connect button shape */}
                    {isWidgetOnly && (
                      <div className="bg-background-3 rounded-lg p-4">
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          disabled={installFetcher.state === "submitting"}
                          onClick={handleWidgetInstall}
                          className="w-full"
                        >
                          {installFetcher.state === "submitting"
                            ? "Connecting..."
                            : `Connect to ${integration.name}`}
                        </Button>
                        {installError && (
                          <p className="text-destructive mt-2 text-sm">
                            {installError}
                          </p>
                        )}
                      </div>
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

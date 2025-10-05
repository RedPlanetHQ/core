import React, { useMemo, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
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
import { Check, Copy, Plus } from "lucide-react";
import { FIXED_INTEGRATIONS } from "~/components/integrations/utils";
import {
  IngestionRule,
  type IntegrationAccount,
  IntegrationDefinitionV2,
} from "@prisma/client";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);
  const { slug } = params;

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId),
  ]);

  // Combine fixed integrations with dynamic ones
  const allIntegrations = [...FIXED_INTEGRATIONS, ...integrationDefinitions];

  const integration = allIntegrations.find(
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

  // Combine fixed integrations with dynamic ones
  const allIntegrations = [...FIXED_INTEGRATIONS, ...integrationDefinitions];

  const integration = allIntegrations.find(
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

function CustomIntegrationContent({ integration }: { integration: any }) {
  const memoryUrl = `https://core.heysol.ai/api/v1/mcp?source=${integration.slug}`;
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(memoryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const getCustomContent = () => {
    switch (integration.id) {
      case "claude":
        return {
          title: "About Claude",
          content: (
            <div className="space-y-4">
              <p className="leading-relaxed">
                Claude is an AI assistant created by Anthropic. It can help with
                a wide variety of tasks including:
              </p>
              <ul className="ml-4 list-inside list-disc space-y-1">
                <li>Code generation and debugging</li>
                <li>Writing and editing</li>
                <li>Analysis and research</li>
                <li>Problem-solving</li>
              </ul>

              <p>
                For Claude Web, Desktop, and Code - OAuth authentication handled
                automatically
              </p>

              <div className="bg-background-3 flex items-center rounded">
                <Input
                  type="text"
                  id="memoryUrl"
                  value={memoryUrl}
                  readOnly
                  className="bg-background-3 block w-full text-base"
                />
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={copyToClipboard}
                  className="px-3"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ),
        };
      case "cursor":
        return {
          title: "About Cursor",
          content: (
            <div className="space-y-4">
              <p className="leading-relaxed">
                Cursor is an AI-powered code editor that helps developers write
                code faster and more efficiently.
              </p>
              <ul className="ml-4 list-inside list-disc space-y-1">
                <li>AI-powered code completion</li>
                <li>Natural language to code conversion</li>
                <li>Code explanation and debugging</li>
                <li>Refactoring assistance</li>
              </ul>
              <div className="bg-background-3 flex items-center rounded p-2">
                <pre className="bg-background-3 m-0 block w-full p-0 text-base break-words whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      memory: {
                        url: memoryUrl,
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        JSON.stringify(
                          {
                            memory: {
                              url: memoryUrl,
                            },
                          },
                          null,
                          2,
                        ),
                      )
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                  }
                  className="px-3"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ),
        };
      case "cline":
        return {
          title: "About Cline",
          content: (
            <div className="space-y-4">
              <p className="leading-relaxed">
                Cline is an AI coding assistant that works directly in your
                terminal and command line environment.
              </p>
              <ul className="ml-4 list-inside list-disc space-y-1">
                <li>Command line AI assistance</li>
                <li>Terminal-based code generation</li>
                <li>Shell script optimization</li>
                <li>DevOps automation help</li>
              </ul>
              <div className="bg-background-3 flex items-center rounded">
                <Input
                  type="text"
                  id="memoryUrl"
                  value={memoryUrl}
                  readOnly
                  className="bg-background-3 block w-full text-base"
                />
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={copyToClipboard}
                  className="px-3"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ),
        };
      case "vscode":
        return {
          title: "About Visual Studio Code",
          content: (
            <div className="space-y-4">
              <p className="leading-relaxed">
                Visual Studio Code is a lightweight but powerful source code
                editor with extensive extension support.
              </p>
              <ul className="ml-4 list-inside list-disc space-y-1">
                <li>Intelligent code completion</li>
                <li>Built-in Git integration</li>
                <li>Extensive extension marketplace</li>
                <li>Debugging and testing tools</li>
              </ul>
              <p>You need to enable MCP in settings</p>
              <div className="bg-background-3 flex flex-col items-start gap-2 rounded p-2">
                <pre>
                  {JSON.stringify(
                    {
                      "chat.mcp.enabled": true,
                      "chat.mcp.discovery.enabled": true,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
              <div className="bg-background-3 flex items-center rounded p-2">
                <pre className="bg-background-3 m-0 block w-full p-0 text-base break-words whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      memory: {
                        type: "http",
                        url: memoryUrl,
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        JSON.stringify(
                          {
                            memory: {
                              type: "http",
                              url: memoryUrl,
                            },
                          },
                          null,
                          2,
                        ),
                      )
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                  }
                  className="px-3"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ),
        };
      default:
        return null;
    }
  };

  const customContent = getCustomContent();

  if (!customContent) return null;
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
        <div className="w-5xl">
          <Section
            title={integration.name}
            description={integration.description}
            icon={
              <div className="bg-grayAlpha-100 flex h-12 w-12 items-center justify-center rounded">
                <Component size={24} />
              </div>
            }
          >
            <div>{customContent.content}</div>
          </Section>
        </div>
      </div>
    </div>
  );
}

interface IntegrationDetailProps {
  integration: any;
  integrationAccounts: any;
  ingestionRule: any;
}

export function IntegrationDetail({
  integration,
  integrationAccounts,
  ingestionRule,
}: IntegrationDetailProps) {
  const activeAccount = useMemo(
    () =>
      integrationAccounts.find(
        (acc: IntegrationAccount) =>
          acc.integrationDefinitionId === integration.id && acc.isActive,
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
    specData?.mcp?.type === "http" && specData?.mcp?.needsAuth
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
        <div className="w-5xl">
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
              <ConnectedAccountSection activeAccount={activeAccount as any} />

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

export default function IntegrationDetailWrapper() {
  const { integration, integrationAccounts, ingestionRule } =
    useLoaderData<typeof loader>();

  const { slug } = useParams();
  // You can now use the `slug` param in your component

  const fixedIntegration = FIXED_INTEGRATIONS.some(
    (fixedInt) => fixedInt.slug === slug,
  );

  return (
    <>
      {fixedIntegration ? (
        <CustomIntegrationContent integration={integration} />
      ) : (
        <IntegrationDetail
          integration={integration}
          integrationAccounts={integrationAccounts}
          ingestionRule={ingestionRule}
        />
      )}
    </>
  );
}

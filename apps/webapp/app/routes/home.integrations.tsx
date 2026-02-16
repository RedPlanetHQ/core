import { useMemo, useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator, useFetcher } from "@remix-run/react";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { IntegrationGrid } from "~/components/integrations/integration-grid";
import { PageHeader } from "~/components/common/page-header";
import { Plus, Trash2, Plug } from "lucide-react";
import { prisma } from "~/db.server";
import { updateUser } from "~/models/user.server";

import { PROVIDER_CONFIGS } from "~/components/onboarding/provider-config";
import { type Provider } from "~/components/onboarding/types";
import { useMcpSessions } from "~/hooks/use-mcp-sessions";
import { ProviderCard } from "~/components/integrations/provider-card";
import { Button, Input } from "~/components/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

type McpIntegration = {
  name: string;
  serverUrl: string;
  apiKey?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const metadata = (user?.metadata as any) || {};
  const mcpIntegrations = (metadata?.mcpIntegrations || []) as McpIntegration[];

  if (!workspace) {
    return json({
      integrationDefinitions: [],
      integrationAccounts: [],
      mcpIntegrations,
      userId,
    });
  }

  const [integrationDefinitions, integrationAccounts] = await Promise.all([
    getIntegrationDefinitions(workspace.id),
    getIntegrationAccounts(userId as string),
  ]);

  // Combine fixed integrations with dynamic ones
  const allIntegrations = [...integrationDefinitions];

  return json({
    integrationDefinitions: allIntegrations,
    integrationAccounts,
    mcpIntegrations,
    userId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw json({ error: "User not found" }, { status: 404 });
  }

  const metadata = (user.metadata as any) || {};
  const currentIntegrations = (metadata?.mcpIntegrations ||
    []) as McpIntegration[];

  try {
    switch (intent) {
      case "create": {
        const name = formData.get("name") as string;
        const serverUrl = formData.get("serverUrl") as string;
        const apiKey = formData.get("apiKey") as string | undefined;

        if (!name || !serverUrl) {
          return json(
            { error: "Name and Server URL are required" },
            { status: 400 }
          );
        }

        const newIntegration: McpIntegration = {
          name,
          serverUrl,
          apiKey: apiKey || undefined,
        };

        const updatedIntegrations = [...currentIntegrations, newIntegration];

        await updateUser({
          id: userId,
          metadata: {
            ...metadata,
            mcpIntegrations: updatedIntegrations,
          },
          onboardingComplete: user.onboardingComplete,
        });

        return json({ success: true });
      }

      case "delete": {
        const index = parseInt(formData.get("index") as string);

        if (isNaN(index)) {
          return json({ error: "Invalid index" }, { status: 400 });
        }

        const updatedIntegrations = currentIntegrations.filter(
          (_, i) => i !== index
        );

        await updateUser({
          id: userId,
          metadata: {
            ...metadata,
            mcpIntegrations: updatedIntegrations,
          },
          onboardingComplete: user.onboardingComplete,
        });

        return json({ success: true });
      }

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "An error occurred" },
      { status: 400 }
    );
  }
}

function NewIntegrationForm({
  onCancel,
  onSuccess,
}: {
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean; error?: string }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess();
    }
  }, [fetcher.data, onSuccess]);

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-4">
        <CardTitle>New Custom Integration</CardTitle>
        <CardDescription>
          Use the Model Context Protocol to extend Core's capabilities with
          external data and tools
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="name"
              name="name"
              placeholder="Integration Name"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="serverUrl" className="text-sm font-medium">
              Server URL
            </label>
            <Input
              id="serverUrl"
              name="serverUrl"
              placeholder="https://mcp.example.com/sse"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="apiKey" className="text-sm font-medium">
              API Key (optional)
            </label>
            <Input
              id="apiKey"
              name="apiKey"
              placeholder="sk-..."
              type="password"
            />
          </div>

          {fetcher.data?.error && (
            <div className="text-destructive text-sm">{fetcher.data.error}</div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={fetcher.state === "submitting"}
            >
              {fetcher.state === "submitting" ? "Adding..." : "Add Integration"}
            </Button>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function CustomIntegrationCard({
  integration,
  index,
  onDelete,
}: {
  integration: McpIntegration;
  index: number;
  onDelete: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onDelete();
    }
  }, [fetcher.data, onDelete]);

  return (
    <Card className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-medium">{integration.name}</h3>
          <p className="text-muted-foreground text-xs">{integration.serverUrl}</p>
        </div>
      </div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="index" value={index} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={fetcher.state === "submitting"}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </fetcher.Form>
    </Card>
  );
}

export default function Integrations() {
  const { integrationDefinitions, integrationAccounts, mcpIntegrations } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [showNewForm, setShowNewForm] = useState(false);

  const { sessions } = useMcpSessions({
    endpoint: "/api/v1/mcp/sessions",
  });

  // Get unique provider names from MCP sessions
  const connectedProviders = new Set(
    sessions
      .filter((session) => session.source)
      .map((session) => session.source!.toLowerCase())
  );

  const activeAccountIds = useMemo(
    () =>
      new Set(
        integrationAccounts
          .filter((acc) => acc.isActive)
          .map((acc) => acc.integrationDefinitionId)
      ),
    [integrationAccounts]
  );

  const isProviderConnected = (provider: Provider): boolean => {
    return connectedProviders.has(provider.toLowerCase());
  };

  const providers = Object.values(PROVIDER_CONFIGS);

  return (
    <>
      <div className="flex h-full flex-col">
        <PageHeader title="Integrations" />
        <div className="home flex h-[calc(100vh_-_40px)] flex-col gap-6 overflow-y-auto p-4 px-5 md:h-[calc(100vh_-_56px)]">
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

          {/* Custom MCP Integrations Section */}
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Custom Integrations</h2>
                <p className="text-muted-foreground text-sm">
                  Connect external MCP servers to extend Core with custom tools
                  and data sources.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowNewForm(true)}
                disabled={showNewForm}
                className="gap-2"
              >
                <Plus size={14} />
                Add Custom Integration
              </Button>
            </div>

            {showNewForm && (
              <NewIntegrationForm
                onCancel={() => setShowNewForm(false)}
                onSuccess={() => {
                  setShowNewForm(false);
                  revalidator.revalidate();
                }}
              />
            )}

            {mcpIntegrations.length === 0 && !showNewForm ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">
                  No custom integrations configured. Click "Add Custom
                  Integration" to connect an MCP server.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mcpIntegrations.map((integration, index) => (
                  <CustomIntegrationCard
                    key={index}
                    integration={integration}
                    index={index}
                    onDelete={() => revalidator.revalidate()}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

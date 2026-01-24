import React from "react";
import { SettingSection } from "~/components/setting-section";
import { Button, Input } from "~/components/ui";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useRevalidator, useFetcher } from "@remix-run/react";
import { prisma } from "~/db.server";
import { requireUserId } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import { Trash2, Plus } from "lucide-react";
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const metadata = user.metadata as any;
  const mcpIntegrations = (metadata?.mcpIntegrations || []) as McpIntegration[];

  return json({ mcpIntegrations });
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

  const metadata = user.metadata as any;
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
            { status: 400 },
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
          (_, i) => i !== index,
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
      { status: 400 },
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
  const fetcher = useFetcher<{ success: string; error?: string }>();

  React.useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess();
    }
  }, [fetcher.data, onSuccess]);

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-4">
        <CardTitle>New MCP</CardTitle>
        <CardDescription>
          Use the Model Context Protocol to extend CORE's capabilities with
          external data and tools
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />

          <div className="space-y-2">
            <label htmlFor="name">Name</label>
            <Input
              id="name"
              name="name"
              placeholder="Integration Name"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="serverUrl">Server URL</label>
            <Input
              id="serverUrl"
              name="serverUrl"
              placeholder="https://mcp.example.com/sse"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="apiKey">API Key (optional)</label>
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

function IntegrationCard({
  integration,
  index,
  onDelete,
}: {
  integration: McpIntegration;
  index: number;
  onDelete: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  React.useEffect(() => {
    if (fetcher.data?.success) {
      onDelete();
    }
  }, [fetcher.data, onDelete]);

  return (
    <Card className="p-2">
      <CardContent className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-semibold">{integration.name}</h3>
          <p className="text-muted-foreground text-sm">
            {integration.serverUrl}
          </p>
          <p className="text-muted-foreground text-xs">
            {integration.apiKey ? "API Key configured" : ""}
          </p>
        </div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="index" value={index} />
          <Button
            type="submit"
            variant="ghost"
            className="rounded"
            size="sm"
            disabled={fetcher.state === "submitting"}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export default function McpIntegrations() {
  const { mcpIntegrations } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [showNewForm, setShowNewForm] = React.useState(false);

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="MCP Integrations"
        description="Use the Model Context Protocol to extend Poke's capabilities with external data and tools"
      >
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setShowNewForm(true)}
              disabled={showNewForm}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Integration
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

          <div className="space-y-3">
            {mcpIntegrations.length === 0 && !showNewForm && (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">
                    No integrations configured yet. Click "New Integration" to
                    add one.
                  </p>
                </CardContent>
              </Card>
            )}

            {mcpIntegrations.map((integration, index) => (
              <IntegrationCard
                key={index}
                integration={integration}
                index={index}
                onDelete={() => revalidator.revalidate()}
              />
            ))}
          </div>
        </div>
      </SettingSection>
    </div>
  );
}

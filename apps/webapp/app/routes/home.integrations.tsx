import { useMemo, useState, useEffect } from "react";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useRevalidator,
  useFetcher,
  useSearchParams,
} from "@remix-run/react";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";
import { IntegrationGrid } from "~/components/integrations/integration-grid";
import { CustomMcpGrid } from "~/components/integrations/custom-mcp-grid";
import { type McpIntegration } from "~/components/integrations/custom-mcp-card";
import { PageHeader } from "~/components/common/page-header";
import { Plus } from "lucide-react";
import { prisma } from "~/db.server";
import { updateUser } from "~/models/user.server";

import { Button, Input } from "~/components/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { useToast } from "~/hooks/use-toast";

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
    getIntegrationAccounts(userId as string, workspace.id),
  ]);

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
        const accessToken = formData.get("accessToken") as string | undefined;

        if (!name || !serverUrl) {
          return json(
            { error: "Name and Server URL are required" },
            { status: 400 },
          );
        }

        const newIntegration: McpIntegration = {
          id: crypto.randomUUID(),
          name,
          serverUrl,
          ...(accessToken && {
            oauth: {
              accessToken,
            },
          }),
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
  const fetcher = useFetcher<{
    success: boolean;
    error?: string;
    redirectURL?: string;
  }>();
  const localFetcher = useFetcher<{ success: boolean; error?: string }>();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.redirectURL) {
      setIsRedirecting(true);
      window.location.href = fetcher.data.redirectURL;
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (localFetcher.data?.success) {
      onSuccess();
    }
  }, [localFetcher.data, onSuccess]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (accessToken.trim()) {
      formData.set("intent", "create");
      formData.set("accessToken", accessToken);
      localFetcher.submit(formData, { method: "post" });
    } else {
      formData.set("intent", "initiate");
      formData.set("redirectURL", window.location.href);
      fetcher.submit(formData, {
        method: "post",
        action: "/api/v1/oauth/custom-mcp",
      });
    }
  };

  const isSubmitting =
    fetcher.state === "submitting" || localFetcher.state === "submitting";

  return (
    <Card className="p-4">
      <CardHeader className="p-0 pb-4">
        <CardTitle>New Custom Integration</CardTitle>
        <CardDescription>
          Connect an external MCP server using OAuth or an access token
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label htmlFor="accessToken" className="text-sm font-medium">
              Access Token (optional)
            </label>
            <Input
              id="accessToken"
              name="accessToken"
              placeholder="sk-..."
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Provide an access token to skip OAuth, or leave empty to
              authenticate via OAuth
            </p>
          </div>

          {(fetcher.data?.error || localFetcher.data?.error) && (
            <div className="text-destructive text-sm">
              {fetcher.data?.error || localFetcher.data?.error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={isSubmitting || isRedirecting}
            >
              {isSubmitting
                ? "Connecting..."
                : isRedirecting
                  ? "Redirecting..."
                  : accessToken.trim()
                    ? "Add Integration"
                    : "Connect with OAuth"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Integrations() {
  const { integrationDefinitions, integrationAccounts, mcpIntegrations } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const integrationName = searchParams.get("integrationName");

    if (success === "true" && integrationName) {
      toast({
        title: "Integration connected",
        description: `${integrationName} has been connected successfully.`,
        variant: "success",
      });
      setSearchParams({});
      revalidator.revalidate();
    } else if (success === "false" && error) {
      toast({
        title: "Connection failed",
        description: decodeURIComponent(error),
        variant: "destructive",
      });
      setSearchParams({});
    }
  }, [searchParams, toast, setSearchParams, revalidator]);

  const activeAccountIds = useMemo(
    () =>
      new Set(
        integrationAccounts
          .filter((acc) => acc.isActive)
          .map((acc) => acc.integrationDefinitionId),
      ),
    [integrationAccounts],
  );

  return (
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

          <CustomMcpGrid
            integrations={mcpIntegrations}
            onDelete={() => revalidator.revalidate()}
          />
        </div>
      </div>
    </div>
  );
}

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { SettingSection } from "~/components/setting-section";
import { Card, CardContent } from "~/components/ui/card";
import { requireUser } from "~/services/session.server";
import { listGateways } from "~/services/gateway.server";
import { Monitor, Apple, Terminal } from "lucide-react";
import { cn } from "~/lib/utils";
import { buttonVariants } from "~/components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  const gateways = await listGateways(workspaceId);
  return json({ gateways });
}

function isActive(lastSeenAt: string | null, status: string): boolean {
  if (status !== "CONNECTED") return false;
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(lastSeenAt).toLocaleDateString();
}

export default function GatewaySettings() {
  const { gateways } = useLoaderData<typeof loader>();

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Gateway"
        description="Gateways connect your local machine to CORE, enabling browser, coding, and exec tools."
      >
        {gateways.length === 0 ? (
          <Card>
            <CardContent className="bg-background-2 flex flex-col items-center justify-center py-12">
              <Monitor className="text-muted-foreground mb-4 h-12 w-12" />
              <h3 className="text-lg font-medium">No gateways configured</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Connect your gateway to control your work from anywhere
              </p>
              <a
                href="https://docs.getcore.me/gateway/overview"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Learn how to connect a gateway
              </a>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {gateways.map((gateway) => {
              const active = isActive(gateway.lastSeenAt, gateway.status);
              return (
                <Card key={gateway.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full",
                            active ? "bg-green-500" : "bg-muted-foreground/40",
                          )}
                        />
                        <div>
                          <p className="font-medium">{gateway.name}</p>
                          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            {gateway.description}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "text-xs font-medium",
                            active ? "text-green-500" : "text-muted-foreground",
                          )}
                        >
                          {active ? "Connected" : "Disconnected"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatLastSeen(gateway.lastSeenAt)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </SettingSection>
    </div>
  );
}

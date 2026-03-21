import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Check } from "lucide-react";
import { Button } from "~/components/ui";
import { type LibrarySkill } from "~/lib/skills-library";
import { getIcon, type IconType } from "~/components/icon-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { OAuthAuthSection } from "~/components/integrations/oauth-auth-section";
import { ApiKeyAuthSection } from "~/components/integrations/api-key-auth-section";
import { cn } from "~/lib/utils";

interface IntegrationDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  spec: any;
  isConnected: boolean;
}

interface OnboardingSuggestionsProps {
  skills: LibrarySkill[];
  integrations: IntegrationDef[];
  onComplete: () => void;
  isCompleting?: boolean;
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

function IntegrationConnectModal({
  integration,
  onClose,
}: {
  integration: IntegrationDef | null;
  onClose: () => void;
}) {
  if (!integration) return null;
  const specData = parseSpec(integration.spec);
  const Icon = getIcon(integration.icon as IconType);

  return (
    <Dialog open={!!integration} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-background-2 flex h-8 w-8 items-center justify-center rounded">
              <Icon size={18} />
            </div>
            <DialogTitle>{integration.name}</DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <OAuthAuthSection
            integration={integration}
            specData={specData}
            activeAccount={null}
          />
          <ApiKeyAuthSection
            integration={integration}
            specData={specData}
            activeAccount={null}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OnboardingSuggestions({
  skills,
  integrations,
  onComplete,
  isCompleting,
}: OnboardingSuggestionsProps) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationDef | null>(null);

  const handleInstall = (slug: string) => {
    setInstalledSlugs((prev) => new Set([...prev, slug]));
    fetcher.submit(
      { intent: "install-library-skill", slug },
      { method: "post", action: "/home/agent/skills" },
    );
  };

  return (
    <div className="flex h-[calc(100vh_-_64px)] w-full flex-col overflow-hidden">
      <div className="flex h-full w-full justify-center overflow-y-auto">
        <div className="flex w-full max-w-3xl flex-col gap-8 px-6 pt-10">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">based on what i learned</h2>
            <p className="text-muted-foreground text-base">
              here's what i think would be useful for you.
            </p>
          </div>

          {skills.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-muted-foreground text-sm font-medium">
                skills
              </h3>
              <div className="border-border divide-y rounded-lg border">
                {skills.map((skill) => {
                  const installed = installedSlugs.has(skill.slug);
                  return (
                    <div
                      key={skill.slug}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{skill.title}</p>
                        <p className="text-muted-foreground truncate text-sm">
                          {skill.shortDescription}
                        </p>
                      </div>

                      <Button
                        variant={installed ? "ghost" : "secondary"}
                        className={cn(
                          "shrink-0",
                          installed && "!bg-tranparent",
                        )}
                        onClick={() => !installed && handleInstall(skill.slug)}
                      >
                        {installed ? (
                          <Check className="text-success size-3.5" />
                        ) : (
                          "install"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {integrations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-muted-foreground text-sm font-medium">
                integrations
              </h3>
              <div className="border-border divide-y rounded-lg border">
                {integrations.map((integration) => {
                  const Icon = getIcon(integration.icon as IconType);
                  return (
                    <div
                      key={integration.slug}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="bg-background-2 flex h-7 w-7 shrink-0 items-center justify-center rounded">
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium">{integration.name}</p>
                          <p className="text-muted-foreground truncate text-sm">
                            {integration.description}
                          </p>
                        </div>
                      </div>
                      {integration.isConnected ? (
                        <Button
                          variant="ghost"
                          className="text-success !bg-transparent"
                        >
                          <Check className="text-success size-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="shrink-0"
                          onClick={() => setSelectedIntegration(integration)}
                        >
                          connect
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t-1 border-border flex w-full shrink-0 flex-col items-center justify-center space-y-4">
        <div className="flex w-full max-w-3xl flex-wrap items-center justify-between py-2">
          <p className="text-muted-foreground text-sm">
            you can add more anytime from integrations and skills.
          </p>
          <Button
            size="lg"
            variant="secondary"
            onClick={onComplete}
            disabled={isCompleting}
            isLoading={isCompleting}
          >
            continue
          </Button>
        </div>
      </div>
      <IntegrationConnectModal
        integration={selectedIntegration}
        onClose={() => setSelectedIntegration(null)}
      />
    </div>
  );
}

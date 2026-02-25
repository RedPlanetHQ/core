import { useState } from "react";
import { type FetcherWithComponents } from "@remix-run/react";
import { type Workspace } from "@prisma/client";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { ArrowRightLeft, LoaderCircle } from "lucide-react";
import Logo from "~/components/logo/logo";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import { getIconForAuthorise } from "~/components/icon-utils";
import { WorkspaceSelector } from "~/components/workspace-selector";

const prettyClientNames: Record<string, string> = {
  "claude-code": "Claude Code",
  "cursor-vscode": "Cursor",
  "Visual Studio Code": "VSCode",
  "windsurf-client": "Windsurf",
  "claude-ai": "Claude Desktop",
  whatsapp: "Whatsapp",
  "core-cli": "Core cli",
};

interface AuthorizeViewProps {
  user: { name: string | null };
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  clientName: string;
  source: string;
  token: string;
  fetcher: FetcherWithComponents<any>;
}

export function AuthorizeView({
  user,
  workspaces,
  currentWorkspace,
  clientName,
  source,
  token,
  fetcher,
}: AuthorizeViewProps) {
  const [selectedWorkspace, setSelectedWorkspace] = useState(currentWorkspace);

  const isSubmitting = fetcher.state === "submitting";

  const handleWorkspaceChange = (workspace: Workspace) => {
    setSelectedWorkspace(workspace);
  };

  return (
    <LoginPageLayout>
      <Card className="bg-background-3 w-full max-w-md rounded-lg border border-gray-300 p-4 sm:p-6 md:p-8">
        <CardContent className="p-0">
          <div className="mb-4 flex items-center justify-center gap-2 sm:mb-6 sm:gap-3 md:gap-4">
            {getIconForAuthorise(
              prettyClientNames[clientName] ?? clientName,
              32,
            )}
            <ArrowRightLeft size={14} className="shrink-0 sm:h-4 sm:w-4" />
            <Logo size={32} />
          </div>

          <div className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
            <div className="flex items-center justify-center px-2 text-center">
              <div>
                <p className="text-base font-normal leading-tight sm:text-lg md:text-xl">
                  {prettyClientNames[clientName] ?? clientName} is requesting
                  access
                </p>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed sm:text-base">
                  Authenticating with your {user.name} account
                </p>
              </div>
            </div>

            <WorkspaceSelector
              workspaces={workspaces}
              selectedWorkspace={selectedWorkspace}
              onWorkspaceChange={handleWorkspaceChange}
            />

            {isSubmitting ? (
              <div className="flex flex-col items-center justify-center px-4 py-6 sm:py-8">
                <LoaderCircle className="text-primary mb-3 h-6 w-6 animate-spin sm:h-8 sm:w-8" />
                <span className="text-muted-foreground px-2 text-center text-sm leading-relaxed sm:text-base">
                  Authorizing...
                </span>
              </div>
            ) : (
              <fetcher.Form method="post" className="space-y-3 sm:space-y-4">
                <input type="hidden" name="token" value={token} />
                <input
                  type="hidden"
                  name="workspaceId"
                  value={selectedWorkspace?.id ?? ""}
                />
                <input type="hidden" name="source" value={source} />
                <input type="hidden" name="clientName" value={clientName} />

                <Button
                  type="submit"
                  size="lg"
                  variant="secondary"
                  className="w-full shadow-none"
                  disabled={!selectedWorkspace}
                >
                  Authorize
                </Button>
              </fetcher.Form>
            )}
          </div>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}

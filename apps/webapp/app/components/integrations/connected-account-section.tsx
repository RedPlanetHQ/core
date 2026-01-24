import React, { useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Check, Trash2 } from "lucide-react";

interface ConnectedAccount {
  id: string;
  accountId: string | null;
  createdAt: string;
  settings?: any;
}

interface ConnectedAccountSectionProps {
  activeAccounts: ConnectedAccount[];
}

export function ConnectedAccountSection({
  activeAccounts,
}: ConnectedAccountSectionProps) {
  const disconnectFetcher = useFetcher();

  const handleDisconnect = useCallback(
    (accountId: string) => {
      disconnectFetcher.submit(
        {
          integrationAccountId: accountId,
        },
        {
          method: "post",
          action: "/api/v1/integration_account/disconnect",
          encType: "application/json",
        },
      );
    },
    [disconnectFetcher],
  );

  React.useEffect(() => {
    if (disconnectFetcher.state === "idle" && disconnectFetcher.data) {
      window.location.reload();
    }
  }, [disconnectFetcher.state, disconnectFetcher.data]);

  if (!activeAccounts || activeAccounts.length === 0) return null;

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-lg font-medium">
        Connected Accounts ({activeAccounts.length})
      </h3>
      <div className="space-y-3">
        {activeAccounts.map((account) => (
          <div key={account.id} className="bg-background-3 rounded-lg p-4">
            <div className="text-sm">
              <p className="inline-flex items-center gap-2 font-medium">
                <Check size={16} /> {account.settings?.workspace_name || account.accountId || "Account"}
              </p>
              <p className="text-muted-foreground mb-3">
                Connected on{" "}
                {new Date(account.createdAt).toLocaleDateString()}
              </p>
              <div className="flex w-full justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={disconnectFetcher.state === "submitting"}
                  onClick={() => handleDisconnect(account.id)}
                >
                  <Trash2 size={14} className="mr-1" />
                  {disconnectFetcher.state === "submitting"
                    ? "Removing..."
                    : "Remove"}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

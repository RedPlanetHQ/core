import React, { useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Check, Trash2 } from "lucide-react";

interface ConnectedAccount {
  id: string;
  accountId: string | null;
  createdAt: string;
  settings?: any;
}

interface ConnectedAccountSectionProps {
  activeAccounts: ConnectedAccount[];
  isAutoReadAvailable?: boolean;
  supportsAutoActivity?: boolean;
}

function AccountRow({
  account,
  isAutoReadAvailable = true,
  supportsAutoActivity = true,
}: {
  account: ConnectedAccount;
  isAutoReadAvailable?: boolean;
  supportsAutoActivity?: boolean;
}) {
  const disconnectFetcher = useFetcher();
  const autoActivityFetcher = useFetcher();

  const handleDisconnect = useCallback(() => {
    disconnectFetcher.submit(
      { integrationAccountId: account.id },
      {
        method: "post",
        action: "/api/v1/integration_account/disconnect",
        encType: "application/json",
      },
    );
  }, [disconnectFetcher, account.id]);

  React.useEffect(() => {
    if (disconnectFetcher.state === "idle" && disconnectFetcher.data) {
      window.location.reload();
    }
  }, [disconnectFetcher.state, disconnectFetcher.data]);

  const optimisticAutoActivity =
    autoActivityFetcher.formData?.get("autoActivityRead") !== undefined
      ? autoActivityFetcher.formData.get("autoActivityRead") === "true"
      : Boolean(account.settings?.autoActivityRead);

  return (
    <div className="bg-background-3 rounded-lg p-4">
      <div className="text-sm">
        <p className="inline-flex items-center gap-2 font-medium">
          <Check size={16} />{" "}
          {account.settings?.workspace_name || account.accountId || "Account"}
        </p>
        <p className="text-muted-foreground mb-3">
          Connected on {new Date(account.createdAt).toLocaleDateString()}
        </p>

        {supportsAutoActivity && (
          <div className="mb-3 flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Activity Auto-Read</Label>
              <p className="text-muted-foreground text-xs">
                Automatically send new activities from this account to your agent
              </p>
              {!isAutoReadAvailable && (
                <p className="text-xs text-amber-500">
                  Upgrade to Pro or Max to enable this feature
                </p>
              )}
            </div>
            <Select
              value={optimisticAutoActivity ? "enabled" : "disabled"}
              onValueChange={(value) => {
                autoActivityFetcher.submit(
                  {
                    intent: "updateAutoActivityRead",
                    integrationAccountId: account.id,
                    autoActivityRead: String(value === "enabled"),
                  },
                  { method: "POST" },
                );
              }}
              disabled={!isAutoReadAvailable}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex w-full justify-end">
          <Button
            variant="destructive"
            className="rounded"
            disabled={disconnectFetcher.state === "submitting"}
            onClick={handleDisconnect}
          >
            <Trash2 size={14} className="mr-1" />
            {disconnectFetcher.state === "submitting"
              ? "Removing..."
              : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConnectedAccountSection({
  activeAccounts,
  isAutoReadAvailable = true,
  supportsAutoActivity = true,
}: ConnectedAccountSectionProps) {
  if (!activeAccounts || activeAccounts.length === 0) return null;

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-lg font-medium">
        Connected Accounts ({activeAccounts.length})
      </h3>
      <div className="space-y-3">
        {activeAccounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            isAutoReadAvailable={isAutoReadAvailable}
            supportsAutoActivity={supportsAutoActivity}
          />
        ))}
      </div>
    </div>
  );
}

import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Plug, Trash2 } from "lucide-react";

export type McpIntegration = {
  name: string;
  serverUrl: string;
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    clientId?: string;
  };
};

interface CustomMcpCardProps {
  integration: McpIntegration;
  index: number;
  onDelete: () => void;
}

export function CustomMcpCard({
  integration,
  index,
  onDelete,
}: CustomMcpCardProps) {
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onDelete();
    }
  }, [fetcher.data, onDelete]);

  const isConnected = !!integration.oauth?.accessToken;

  return (
    <Card className="bg-background-3 transition-all">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="bg-background-2 mb-2 flex h-6 w-6 items-center justify-center rounded">
            <Plug size={18} />
          </div>

          <div className="flex items-center gap-2">
            {isConnected && (
              <Badge className="h-6 rounded !bg-green-100 p-2 text-sm text-green-800">
                Connected
              </Badge>
            )}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="index" value={index} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 rounded"
                disabled={fetcher.state === "submitting"}
              >
                <Trash2 size={14} />
              </Button>
            </fetcher.Form>
          </div>
        </div>
        <CardTitle className="text-base">{integration.name}</CardTitle>
        <CardDescription className="line-clamp-2 text-sm">
          {integration.serverUrl}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

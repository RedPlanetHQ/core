import { Link } from "@remix-run/react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { getIcon, type IconType } from "~/components/icon-utils";
import { Badge } from "../ui/badge";

interface IntegrationCardProps {
  integration: {
    id: string;
    name: string;
    description?: string;
    icon: string;
    slug?: string;
  };
  isConnected: boolean;
}

export function IntegrationCard({
  integration,
  isConnected,
}: IntegrationCardProps) {
  const Component = getIcon(integration.icon as IconType);

  return (
    <Link
      to={`/home/integration/${integration.slug || integration.id}`}
      className="bg-background-3 h-full rounded-lg"
    >
      <Card className="transition-all">
        <CardHeader className="p-4">
          <div className="flex items-center justify-between">
            <div className="bg-background-2 mb-2 flex h-6 w-6 items-center justify-center rounded">
              <Component size={18} />
            </div>

            {isConnected && (
              <div className="flex w-full items-center justify-end">
                <Badge className="h-6 rounded !bg-green-100 p-2 text-sm text-green-800">
                  Connected
                </Badge>
              </div>
            )}
          </div>
          <CardTitle className="text-base">{integration.name}</CardTitle>
          <CardDescription className="line-clamp-2 text-sm">
            {integration.description || `Connect to ${integration.name}`}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

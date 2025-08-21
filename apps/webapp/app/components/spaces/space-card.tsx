import { Link } from "@remix-run/react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "../ui/badge";
import { getIcon } from "../icon-picker";

interface SpaceCardProps {
  space: {
    id: string;
    name: string;
    icon?: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    autoMode: boolean;
    statementCount: number | null;
    summary: string | null;
    themes?: string[];
  };
}

export function SpaceCard({ space }: SpaceCardProps) {
  return (
    <Link
      to={`/home/space/${space.id}/overview`}
      className="bg-background-3 h-full rounded-lg"
    >
      <Card className="transition-all">
        <CardHeader className="p-4">
          <div className="flex items-center justify-between">
            <div className="bg-background-2 mb-2 flex h-6 w-6 items-center justify-center rounded">
              {getIcon(space?.icon, 16)}
            </div>

            {space.autoMode && (
              <div className="flex w-full items-center justify-end">
                <Badge className="h-6 rounded bg-blue-100 p-2 text-xs text-blue-800">
                  Auto
                </Badge>
              </div>
            )}
          </div>
          <CardTitle className="text-base">{space.name}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs">
            {space.description || space.summary || "Knowledge space"}
          </CardDescription>
          <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
            {space.statementCount && space.statementCount > 0 && (
              <div>
                {space.statementCount} fact
                {space.statementCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

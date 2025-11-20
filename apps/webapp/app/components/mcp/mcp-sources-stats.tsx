import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { LoaderCircle } from "lucide-react";
import { getIconForAuthorise } from "../icon-utils";

interface McpSourcesStatsProps {
  sources: Array<{ name: string; slug: string; count: number }>;
  activeSources?: string[];
  isLoading?: boolean;
}

export function McpSourcesStats({
  sources,
  activeSources = [],
  isLoading,
}: McpSourcesStatsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <LoaderCircle className="text-primary h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalSessions = sources.reduce((sum, source) => sum + source.count, 0);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Sources</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-4">
          {sources.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sources found</p>
          ) : (
            <div className="space-y-3">
              {sources.slice(0, 5).map((source) => {
                const percentage =
                  totalSessions > 0 ? (source.count / totalSessions) * 100 : 0;
                return (
                  <div
                    key={source.slug}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1">
                      {getIconForAuthorise(source.name.toLowerCase(), 16)}
                      <span className="mr-1 text-sm">{source.name}</span>
                      <Badge variant="secondary" className="text-sm">
                        {source.count}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="bg-primary h-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-10 text-right text-sm">
                        {percentage.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-4">
          {activeSources.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active sources</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {activeSources.map((source) => (
                <Badge
                  key={source}
                  variant="secondary"
                  className="rounded text-sm"
                >
                  {getIconForAuthorise(source.toLowerCase(), 12)}

                  {source}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

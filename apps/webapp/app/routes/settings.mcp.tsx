import { useState } from "react";
import { useMcpSessions } from "~/hooks/use-mcp-sessions";
import { McpSessionsFilters } from "~/components/mcp/mcp-sessions-filters";
import { VirtualMcpSessionsList } from "~/components/mcp/virtual-mcp-sessions-list";
import { McpSourcesStats } from "~/components/mcp/mcp-sources-stats";
import { Card, CardContent } from "~/components/ui/card";
import { Database, LoaderCircle } from "lucide-react";
import { SettingSection } from "~/components/setting-section";

export default function McpSettings() {
  const [selectedSource, setSelectedSource] = useState<string | undefined>();

  const {
    sessions,
    hasMore,
    loadMore,
    availableSources,
    activeSources,
    isLoading,
    isInitialLoad,
  } = useMcpSessions({
    endpoint: "/api/v1/mcp/sessions",
    source: selectedSource,
  });

  return (
    <div className="mx-auto flex h-full w-auto flex-col gap-4 px-4 pt-6 md:w-3xl">
      <SettingSection
        title="MCP Sessions"
        description="View and manage Model Context Protocol sessions for integrations."
      >
        <div className="flex h-[calc(100vh_-_135px)] w-full flex-col items-center space-y-6">
          {/* Top Sources Stats */}
          <div className="flex w-full flex-col gap-4">
            <McpSourcesStats
              sources={availableSources}
              activeSources={activeSources}
              isLoading={isInitialLoad}
            />
          </div>

          {isInitialLoad ? (
            <div className="flex items-center justify-center py-8">
              <LoaderCircle className="text-primary h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Filters */}
              <McpSessionsFilters
                availableSources={availableSources}
                selectedSource={selectedSource}
                onSourceChange={setSelectedSource}
              />

              {/* Sessions List */}
              <div className="flex h-full w-full space-y-4">
                {sessions.length === 0 ? (
                  <Card className="bg-background-2 w-full">
                    <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                      <div className="text-center">
                        <Database className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                        <h3 className="mb-2 text-lg font-semibold">
                          No MCP sessions found
                        </h3>
                        <p className="text-muted-foreground">
                          {selectedSource
                            ? "Try adjusting your filters to see more results."
                            : "No MCP sessions are available yet."}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <VirtualMcpSessionsList
                    sessions={sessions}
                    hasMore={hasMore}
                    loadMore={loadMore}
                    isLoading={isLoading}
                    height={600}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </SettingSection>
    </div>
  );
}

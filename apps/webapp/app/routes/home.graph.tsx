import React, { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId } from "~/services/session.server";
import { useTypedLoaderData } from "remix-typedjson";

import { LoaderCircle } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { GraphVisualizationClient } from "~/components/graph/graph-client";

export async function loader({ request }: LoaderFunctionArgs) {
  // Only return userId, not the heavy nodeLinks
  const userId = await requireUserId(request);
  return { userId };
}

export default function Dashboard() {
  const { userId } = useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher<any>();
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );

  // Kick off the fetcher on mount if not already done
  React.useEffect(() => {
    if (userId && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/api/v1/graph/clustered");
    }
  }, [userId, fetcher]);

  // Determine loading state
  const loading =
    fetcher.state === "loading" ||
    fetcher.state === "submitting" ||
    !fetcher.data;

  // Get graph data from fetcher
  let graphData: any = null;
  if (fetcher.data && fetcher.data.success) {
    graphData = fetcher.data.data;
  } else if (fetcher.data && !fetcher.data.success) {
    graphData = { triplets: [], clusters: [] };
  }

  return (
    <>
      <PageHeader title="Memory graph" />
      <div className="home flex h-[calc(100vh_-_56px)] flex-col overflow-y-auto p-3 text-base">
        <div className="flex grow items-center justify-center rounded">
          {loading ? (
            <div className="flex h-full w-full flex-col items-center justify-center">
              <LoaderCircle size={18} className="mr-1 animate-spin" />
              <span className="text-muted-foreground">Loading graph...</span>
            </div>
          ) : (
            typeof window !== "undefined" &&
            graphData && (
              <GraphVisualizationClient
                triplets={graphData.triplets || []}
                clusters={graphData.clusters || []}
                selectedClusterId={selectedClusterId}
                onClusterSelect={setSelectedClusterId}
                className="h-full w-full"
              />
            )
          )}
        </div>
      </div>
    </>
  );
}

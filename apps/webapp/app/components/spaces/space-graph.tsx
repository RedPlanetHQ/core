import React, { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId } from "~/services/session.server";
import { useTypedLoaderData } from "remix-typedjson";

import { LoaderCircle } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { GraphVisualizationClient } from "~/components/graph/graph-client";

interface SpaceGraphProps {
  userId: string;
  clusterId: string;
}

export default function SpaceGraph({ userId, clusterId }: SpaceGraphProps) {
  const fetcher = useFetcher<any>();

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
    <div className="home bg-grayAlpha-100 mb-10 flex h-[500px] flex-col overflow-y-auto rounded-lg p-3 text-base">
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
              selectedClusterId={clusterId}
              className="h-full w-full"
              singleClusterView
            />
          )
        )}
      </div>
    </div>
  );
}

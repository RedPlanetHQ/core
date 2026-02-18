import { useState, useMemo, forwardRef, useCallback } from "react";
import {
  type ClusterData,
  GraphClustering,
  type GraphClusteringRef,
  type NodeHoverData,
  type ActiveNodeLabel,
} from "./graph-clustering";
import { GraphFilters } from "./graph-filters";
import { GraphSearch } from "./graph-search";
import { EpisodeSidebar } from "./episode-sidebar";
import { SessionTooltip } from "./session-tooltip";
import type { RawTriplet } from "./type";

import { createLabelColorMap } from "./node-colors";
import { toGraphTriplets } from "./utils";
import { cn } from "~/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";

export interface GraphClusteringVisualizationProps {
  triplets: RawTriplet[];
  clusters: ClusterData[];
  width?: number;
  height?: number;
  zoomOnMount?: boolean;
  className?: string;
  selectedClusterId?: string | null;
  onClusterSelect?: (clusterId: string) => void;
  singleClusterView?: boolean;
  forOnboarding?: boolean;
}

export const GraphClusteringVisualization = forwardRef<
  GraphClusteringRef,
  GraphClusteringVisualizationProps
>(
  (
    {
      triplets,
      clusters,
      width = window.innerWidth * 0.85,
      height = window.innerHeight * 0.85,
      zoomOnMount = true,
      className = "rounded-md h-full overflow-hidden relative",
      selectedClusterId,
      onClusterSelect,
      singleClusterView,
      forOnboarding,
    },
    ref,
  ) => {
    // Search filter - sessionIds from search API
    const [searchSessionIds, setSearchSessionIds] = useState<string[] | null>(null);

    // Sidebar state for session details
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
      null,
    );

    // Hover state for tooltip
    const [hoverData, setHoverData] = useState<NodeHoverData | null>(null);

    // Active nodes state - shows labels for clicked node and its connections
    const [activeNodes, setActiveNodes] = useState<ActiveNodeLabel[]>([]);

    // Get labelIds for search from selectedClusterId
    const searchLabelIds = useMemo(() => {
      return selectedClusterId ? [selectedClusterId] : undefined;
    }, [selectedClusterId]);

    // Handle search results
    const handleSearchSessionIds = useCallback((sessionIds: string[] | null) => {
      setSearchSessionIds(sessionIds);
    }, []);

    // Combined filter logic for all filters
    const filteredTriplets = useMemo(() => {
      let filtered = triplets;

      // Label filter (from dropdown)
      if (selectedClusterId) {
        filtered = filtered.filter(
          (triplet) =>
            triplet.sourceNode.attributes?.clusterId === selectedClusterId ||
            triplet.targetNode.attributes?.clusterId === selectedClusterId,
        );
      }

      // Search filter - filter by sessionIds from search API
      if (searchSessionIds !== null) {
        const sessionIdSet = new Set(searchSessionIds);
        filtered = filtered.filter((triplet) => {
          const sourceMatches = sessionIdSet.has(triplet.sourceNode.uuid);
          const targetMatches = sessionIdSet.has(triplet.targetNode.uuid);
          return sourceMatches || targetMatches;
        });
      }

      return filtered;
    }, [triplets, selectedClusterId, searchSessionIds]);

    // Convert filtered triplets to graph triplets
    const graphTriplets = useMemo(
      () => toGraphTriplets(filteredTriplets),
      [filteredTriplets],
    );

    // Extract all unique labels from triplets
    const allLabels = useMemo(() => {
      const labels = new Set<string>();
      labels.add("Entity"); // Always include Entity as default

      graphTriplets.forEach((triplet) => {
        if (triplet.source.primaryLabel)
          labels.add(triplet.source.primaryLabel);
        if (triplet.target.primaryLabel)
          labels.add(triplet.target.primaryLabel);
      });

      return Array.from(labels).sort((a, b) => {
        // Always put "Entity" first
        if (a === "Entity") return -1;
        if (b === "Entity") return 1;
        // Sort others alphabetically
        return a.localeCompare(b);
      });
    }, [graphTriplets]);

    // Create a shared label color map
    const sharedLabelColorMap = useMemo(() => {
      return createLabelColorMap(allLabels);
    }, [allLabels]);

    // Handle node click - for Session nodes, the nodeId IS the sessionId
    const handleNodeClick = (nodeId: string) => {
      // For Session nodes, the node ID is the sessionId
      // Find the node to verify it's a Session node
      let isSessionNode = false;
      for (const triplet of filteredTriplets) {
        if (triplet.sourceNode.uuid === nodeId || triplet.targetNode.uuid === nodeId) {
          const node = triplet.sourceNode.uuid === nodeId ? triplet.sourceNode : triplet.targetNode;
          isSessionNode = node.labels?.includes("Session") || node.attributes?.nodeType === "Session";
          break;
        }
      }

      if (isSessionNode) {
        // The nodeId is the sessionId for Session nodes
        setSelectedSessionId(nodeId);
      }
    };

    // Handle cluster click - toggle filter like Marvel
    const handleClusterClick = (clusterId: string) => {
      if (onClusterSelect) {
        const newSelection = selectedClusterId === clusterId ? null : clusterId;
        onClusterSelect(newSelection as string);
      }
    };

    return (
      <ResizablePanelGroup
        orientation="horizontal"
        className={cn("h-full z-50", className)}
      >
        <ResizablePanel maxSize={selectedSessionId ? 50 : 100}>
          <div className="flex h-full flex-col gap-4 p-3 w-full z-50">
            {/* Filter Controls */}
            {!singleClusterView && (
              <div className="flex flex-col">
                {/* Graph Filters and Search in same row */}
                <div className="flex items-center gap-1">
                  <GraphFilters
                    clusters={clusters}
                    selectedCluster={selectedClusterId}
                    onClusterChange={onClusterSelect as any}
                  />
                  <GraphSearch
                    labelIds={searchLabelIds}
                    onSessionIdsChange={handleSearchSessionIds}
                  />
                </div>
              </div>
            )}

            {filteredTriplets.length > 0 ? (
              <div className="relative h-full w-full">
                <GraphClustering
                  ref={ref}
                  triplets={graphTriplets}
                  clusters={clusters}
                  width={width}
                  height={height}
                  onNodeClick={handleNodeClick}
                  onNodeHover={setHoverData}
                  onActiveNodesChange={setActiveNodes}
                  onClusterClick={handleClusterClick}
                  zoomOnMount={zoomOnMount}
                  labelColorMap={sharedLabelColorMap}
                  showClusterLabels={!selectedClusterId}
                  enableClusterColors={true}
                  forOnboarding={forOnboarding}
                />

                {/* Hover tooltip for session nodes */}
                {hoverData && activeNodes.length === 0 && (
                  <SessionTooltip
                    sessionId={hoverData.sessionId}
                    position={hoverData.position}
                  />
                )}

                {/* Active node labels - shown when a node is clicked */}
                {activeNodes.map((node) => (
                  <SessionTooltip
                    key={node.sessionId}
                    sessionId={node.sessionId}
                    position={node.position}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  No graph data to visualize.
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>

        {selectedSessionId && (
          <>
            <ResizableHandle />
            <ResizablePanel maxSize={50}>
              <EpisodeSidebar
                sessionId={selectedSessionId}
                onClose={() => setSelectedSessionId(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    );
  },
);

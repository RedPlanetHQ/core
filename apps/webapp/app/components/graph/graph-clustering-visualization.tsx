import { useState, useMemo, forwardRef } from "react";
import {
  type ClusterData,
  GraphClustering,
  type GraphClusteringRef,
} from "./graph-clustering";
import { GraphFilters } from "./graph-filters";
import { SpaceSearch } from "./space-search";
import { EpisodeSidebar } from "./episode-sidebar";
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
    const [searchQuery, setSearchQuery] = useState<string>("");

    // Sidebar state for episode details
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
      null,
    );

    // Combined filter logic for all filters
    const filteredTriplets = useMemo(() => {
      let filtered = triplets;

      // Original cluster filter (from dropdown)
      if (selectedClusterId) {
        filtered = filtered.filter(
          (triplet) =>
            triplet.sourceNode.attributes?.clusterId === selectedClusterId ||
            triplet.targetNode.attributes?.clusterId === selectedClusterId,
        );
      }

      // Search filter
      if (searchQuery.trim()) {
        // Helper functions for filtering
        const isEpisodeNode = (node: any) => {
          return (
            node.attributes?.content ||
            node.attributes?.episodeUuid ||
            (node.labels && node.labels.includes("Episode"))
          );
        };

        const query = searchQuery.toLowerCase();
        filtered = filtered.filter((triplet) => {
          const sourceMatches =
            isEpisodeNode(triplet.sourceNode) &&
            triplet.sourceNode.attributes?.content
              ?.toLowerCase()
              .includes(query);
          const targetMatches =
            isEpisodeNode(triplet.targetNode) &&
            triplet.targetNode.attributes?.content
              ?.toLowerCase()
              .includes(query);

          return sourceMatches || targetMatches;
        });
      }

      return filtered;
    }, [triplets, selectedClusterId, onClusterSelect, searchQuery]);

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

    // Handle node click
    const handleNodeClick = (nodeId: string) => {
      // Find the triplet that contains this node by searching through graphTriplets
      let foundNode = null;
      for (const triplet of filteredTriplets) {
        if (triplet.sourceNode.uuid === nodeId) {
          foundNode = triplet.sourceNode;
          break;
        } else if (triplet.targetNode.uuid === nodeId) {
          foundNode = triplet.targetNode;
          break;
        }
      }

      if (!foundNode) {
        // Try to find in the converted graph triplets
        for (const graphTriplet of graphTriplets) {
          if (graphTriplet.source.id === nodeId) {
            foundNode = {
              uuid: graphTriplet.source.id,
              value: graphTriplet.source.value,
              primaryLabel: graphTriplet.source.primaryLabel,
              attributes: graphTriplet.source,
            } as any;
            break;
          } else if (graphTriplet.target.id === nodeId) {
            foundNode = {
              uuid: graphTriplet.target.id,
              value: graphTriplet.target.value,
              primaryLabel: graphTriplet.target.primaryLabel,
              attributes: graphTriplet.target,
            };
            break;
          }
        }
      }

      if (!foundNode) return;

      // Check if it's an Episode node with queueId
      const isEpisode = foundNode.labels?.includes("Episode");
      const sessionId = foundNode.attributes?.sessionId;

      if (isEpisode && sessionId) {
        // Show sidebar for episodes
        setSelectedSessionId(sessionId);
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
        direction="horizontal"
        className={cn("h-full", className)}
      >
        <ResizablePanel defaultSize={selectedSessionId ? 70 : 100}>
          <div className="flex h-full flex-col gap-4 p-3">
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
                  <SpaceSearch
                    triplets={triplets}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                  />
                </div>
              </div>
            )}

            {filteredTriplets.length > 0 ? (
              <GraphClustering
                ref={ref}
                triplets={graphTriplets}
                clusters={clusters}
                width={width}
                height={height}
                onNodeClick={handleNodeClick}
                onClusterClick={handleClusterClick}
                zoomOnMount={zoomOnMount}
                labelColorMap={sharedLabelColorMap}
                showClusterLabels={!selectedClusterId}
                enableClusterColors={true}
                forOnboarding={forOnboarding}
              />
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
            <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
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

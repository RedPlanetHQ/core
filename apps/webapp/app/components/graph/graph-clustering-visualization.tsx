import { useState, useMemo, forwardRef } from "react";
import { useTheme } from "remix-themes";
import {
  type ClusterData,
  GraphClustering,
  type GraphClusteringRef,
} from "./graph-clustering";
import { GraphPopovers } from "./graph-popover";
import { GraphFilters } from "./graph-filters";
import { SpaceSearch } from "./space-search";
import type { RawTriplet, NodePopupContent, EdgePopupContent } from "./type";

import { createLabelColorMap } from "./node-colors";
import { toGraphTriplets } from "./utils";
import { cn } from "~/lib/utils";

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
    },
    ref,
  ) => {
    // Graph state for popovers
    const [showNodePopup, setShowNodePopup] = useState<boolean>(false);
    const [showEdgePopup, setShowEdgePopup] = useState<boolean>(false);
    const [nodePopupContent, setNodePopupContent] =
      useState<NodePopupContent | null>(null);
    const [edgePopupContent, setEdgePopupContent] =
      useState<EdgePopupContent | null>(null);

    const [selectedEntityType, setSelectedEntityType] = useState<
      string | undefined
    >();
    const [searchQuery, setSearchQuery] = useState<string>("");

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

      // Entity type filter
      if (selectedEntityType) {
        filtered = filtered.filter((triplet) => {
          const sourceMatches =
            triplet.sourceNode.attributes?.type === selectedEntityType;
          const targetMatches =
            triplet.targetNode.attributes?.type === selectedEntityType;

          return sourceMatches || targetMatches;
        });
      }

      // Search filter
      if (searchQuery.trim()) {
        // Helper functions for filtering
        const isStatementNode = (node: any) => {
          return (
            node.attributes?.fact ||
            (node.labels && node.labels.includes("Statement"))
          );
        };

        const query = searchQuery.toLowerCase();
        filtered = filtered.filter((triplet) => {
          const sourceMatches =
            isStatementNode(triplet.sourceNode) &&
            triplet.sourceNode.attributes?.fact?.toLowerCase().includes(query);
          const targetMatches =
            isStatementNode(triplet.targetNode) &&
            triplet.targetNode.attributes?.fact?.toLowerCase().includes(query);

          return sourceMatches || targetMatches;
        });
      }

      return filtered;
    }, [
      triplets,
      selectedClusterId,
      onClusterSelect,
      selectedEntityType,
      searchQuery,
    ]);

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

      // Set popup content and show the popup
      setNodePopupContent({
        id: nodeId,
        node: foundNode,
      });
      setShowNodePopup(true);
      setShowEdgePopup(false);
    };

    // Handle edge click
    const handleEdgeClick = (edgeId: string) => {
      // Find the triplet that contains this edge
      const triplet = triplets.find((t) => t.edge.uuid === edgeId);

      if (!triplet) return;

      // Set popup content and show the popup
      setEdgePopupContent({
        id: edgeId,
        source: triplet.sourceNode,
        target: triplet.targetNode,
        relation: triplet.edge,
      });
      setShowEdgePopup(true);
      setShowNodePopup(false);
    };

    // Handle cluster click - toggle filter like Marvel
    const handleClusterClick = (clusterId: string) => {
      if (onClusterSelect) {
        const newSelection = selectedClusterId === clusterId ? null : clusterId;
        onClusterSelect(newSelection as string);
      }
    };

    // Handle popover close
    const handlePopoverClose = () => {
      setShowNodePopup(false);
      setShowEdgePopup(false);
    };

    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {/* Filter Controls */}
        {!singleClusterView && (
          <div className="flex flex-col">
            {/* Graph Filters and Search in same row */}
            <div className="flex items-center gap-1">
              <GraphFilters
                triplets={triplets}
                clusters={clusters}
                selectedCluster={selectedClusterId}
                selectedEntityType={selectedEntityType}
                onClusterChange={onClusterSelect as any}
                onEntityTypeChange={setSelectedEntityType}
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
            onEdgeClick={handleEdgeClick}
            onClusterClick={handleClusterClick}
            onBlur={handlePopoverClose}
            zoomOnMount={zoomOnMount}
            labelColorMap={sharedLabelColorMap}
            showClusterLabels={!selectedClusterId} // Show cluster labels when not filtering
            enableClusterColors={true} // Always enable cluster colors
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">No graph data to visualize.</p>
          </div>
        )}

        {/* Standard Graph Popovers */}
        <GraphPopovers
          showNodePopup={showNodePopup}
          showEdgePopup={showEdgePopup}
          nodePopupContent={nodePopupContent}
          edgePopupContent={edgePopupContent}
          onOpenChange={handlePopoverClose}
          labelColorMap={sharedLabelColorMap}
        />
      </div>
    );
  },
);

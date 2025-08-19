import { useState, useMemo, forwardRef, useEffect } from "react";
import { useTheme } from "remix-themes";
import {
  type ClusterData,
  GraphClustering,
  type GraphClusteringRef,
} from "./graph-clustering";
import { GraphPopovers } from "./graph-popover";
import type { RawTriplet, NodePopupContent, EdgePopupContent } from "./type";
import { Card, CardContent } from "~/components/ui/card";

import { createLabelColorMap, nodeColorPalette } from "./node-colors";
import { toGraphTriplets } from "./utils";
import { cn } from "~/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export interface GraphClusteringVisualizationProps {
  triplets: RawTriplet[];
  clusters: ClusterData[];
  width?: number;
  height?: number;
  zoomOnMount?: boolean;
  className?: string;
  selectedClusterId?: string | null;
  onClusterSelect?: (clusterId: string | null) => void;
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
    },
    ref,
  ) => {
    console.log(clusters);
    const [themeMode] = useTheme();

    // Graph state for popovers
    const [showNodePopup, setShowNodePopup] = useState<boolean>(false);
    const [showEdgePopup, setShowEdgePopup] = useState<boolean>(false);
    const [nodePopupContent, setNodePopupContent] =
      useState<NodePopupContent | null>(null);
    const [edgePopupContent, setEdgePopupContent] =
      useState<EdgePopupContent | null>(null);

    // Filter triplets based on selected cluster (like Marvel's comic filter)
    const filteredTriplets = useMemo(() => {
      if (!selectedClusterId) return triplets;

      // Filter triplets to show only nodes from the selected cluster
      return triplets.filter(
        (triplet) =>
          triplet.sourceNode.attributes?.clusterId === selectedClusterId ||
          triplet.targetNode.attributes?.clusterId === selectedClusterId,
      );
    }, [triplets, selectedClusterId]);

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
        onClusterSelect(newSelection);
      }
    };

    // Handle popover close
    const handlePopoverClose = () => {
      setShowNodePopup(false);
      setShowEdgePopup(false);
    };

    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {/* Cluster Filter Dropdown - Marvel style */}
        <div>
          <Card className="bg-transparent">
            <CardContent className="bg-transparent p-1">
              <div className="flex items-center gap-2">
                <Select
                  value={selectedClusterId || ""}
                  onValueChange={(value) =>
                    value === "all_clusters"
                      ? onClusterSelect?.("")
                      : onClusterSelect?.(value || null)
                  }
                >
                  <SelectTrigger
                    className="bg-background w-48 rounded px-2 py-1 text-sm"
                    showIcon
                  >
                    <SelectValue placeholder="All Spaces" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_clusters">All Spaces</SelectItem>
                    {clusters.map((cluster, index) => {
                      // Get cluster color from the same palette used in the graph
                      const palette =
                        themeMode === "dark"
                          ? nodeColorPalette.dark
                          : nodeColorPalette.light;
                      const clusterColor = palette[index % palette.length];

                      return (
                        <SelectItem key={cluster.id} value={cluster.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: clusterColor }}
                            />
                            <span>{cluster.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

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

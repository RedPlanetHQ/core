import {
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import Sigma from "sigma";
import GraphologyGraph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { EdgeLineProgram } from "sigma/rendering";
import colors from "tailwindcss/colors";
import type { GraphTriplet, IdValue, GraphNode } from "./type";
import {
  createLabelColorMap,
  getNodeColor as getNodeColorByLabel,
  nodeColorPalette,
} from "./node-colors";
import { useTheme } from "remix-themes";
import { drawHover } from "./utils";

export interface ClusterData {
  id: string;
  name: string;
  description?: string;
  size: number;
  cohesionScore?: number;
  aspectType?: "thematic" | "social" | "activity";
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
}

export interface GraphClusteringProps {
  triplets: GraphTriplet[];
  clusters: ClusterData[];
  width?: number;
  height?: number;
  zoomOnMount?: boolean;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onClusterClick?: (clusterId: string) => void;
  onBlur?: () => void;
  labelColorMap?: Map<string, number>;
  showClusterLabels?: boolean;
  enableClusterColors?: boolean;
}

export interface GraphClusteringRef {
  zoomToLinkById: (linkId: string) => void;
  zoomToCluster: (clusterId: string) => void;
  highlightCluster: (clusterId: string) => void;
  resetHighlights: () => void;
}

// Use node-colors palette for cluster colors
const generateClusterColors = (
  clusterCount: number,
  isDarkMode: boolean,
): string[] => {
  const palette = isDarkMode ? nodeColorPalette.dark : nodeColorPalette.light;
  const colors: string[] = [];

  for (let i = 0; i < clusterCount; i++) {
    colors.push(palette[i % palette.length]);
  }

  return colors;
};

export const GraphClustering = forwardRef<
  GraphClusteringRef,
  GraphClusteringProps
>(
  (
    {
      triplets,
      clusters,
      width = 1000,
      height = 800,
      zoomOnMount = false,
      onNodeClick,
      onEdgeClick,
      onClusterClick,
      onBlur,
      labelColorMap: externalLabelColorMap,
      showClusterLabels = true,
      enableClusterColors = true,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sigmaRef = useRef<Sigma | null>(null);
    const graphRef = useRef<GraphologyGraph | null>(null);
    const clustersLayerRef = useRef<HTMLDivElement | null>(null);
    const [themeMode] = useTheme();

    const isInitializedRef = useRef(false);
    const selectedNodeRef = useRef<string | null>(null);
    const selectedEdgeRef = useRef<string | null>(null);
    const selectedClusterRef = useRef<string | null>(null);

    // Create cluster color mapping
    const clusterColorMap = useMemo(() => {
      if (!enableClusterColors) return new Map();

      const clusterIds = clusters.map((c) => c.id);
      const clusterColors = generateClusterColors(
        clusterIds.length,
        themeMode === "dark",
      );
      const colorMap = new Map<string, string>();

      clusterIds.forEach((id, index) => {
        colorMap.set(id, clusterColors[index]);
      });

      return colorMap;
    }, [clusters, enableClusterColors, themeMode]);

    // Memoize theme to prevent unnecessary recreation
    const theme = useMemo(
      () => ({
        node: {
          fill: colors.pink[500],
          stroke: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          hover: "#646464",
          text: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          selected: "#646464",
          dimmed: colors.pink[300],
        },
        link: {
          stroke: colors.gray[400],
          selected: "#646464",
          dimmed: themeMode === "dark" ? colors.slate[800] : colors.slate[200],
        },
        cluster: {
          labelColor:
            themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          labelBg:
            themeMode === "dark"
              ? colors.slate[800] + "CC"
              : colors.slate[200] + "CC",
        },
        background:
          themeMode === "dark" ? colors.slate[900] : colors.slate[100],
      }),
      [themeMode],
    );

    // Extract all unique labels from triplets
    const allLabels = useMemo(() => {
      if (externalLabelColorMap) return [];
      const labels = new Set<string>();
      labels.add("Entity");
      triplets.forEach((triplet) => {
        if (triplet.source.primaryLabel)
          labels.add(triplet.source.primaryLabel);
        if (triplet.target.primaryLabel)
          labels.add(triplet.target.primaryLabel);
      });
      return Array.from(labels);
    }, [triplets, externalLabelColorMap]);

    // Create a mapping of label to color
    const labelColorMap = useMemo(() => {
      return externalLabelColorMap || createLabelColorMap(allLabels);
    }, [allLabels, externalLabelColorMap]);

    // Create a mapping of node IDs to their data
    const nodeDataMap = useMemo(() => {
      const result = new Map<string, GraphNode>();
      triplets.forEach((triplet) => {
        result.set(triplet.source.id, triplet.source);
        result.set(triplet.target.id, triplet.target);
      });
      return result;
    }, [triplets]);

    // Function to get node color (with cluster coloring support)
    const getNodeColor = useCallback(
      (node: any): string => {
        if (!node) {
          return getNodeColorByLabel(null, themeMode === "dark", labelColorMap);
        }

        const nodeData = nodeDataMap.get(node.id) || node;

        // Check if this is a Statement node
        const isStatementNode =
          nodeData.attributes.nodeType === "Statement" ||
          (nodeData.labels && nodeData.labels.includes("Statement"));

        if (isStatementNode) {
          // Statement nodes with cluster IDs use cluster colors
          if (
            enableClusterColors &&
            nodeData.clusterId &&
            clusterColorMap.has(nodeData.clusterId)
          ) {
            return clusterColorMap.get(nodeData.clusterId)!;
          }

          // Unclustered statement nodes use a specific light color
          return themeMode === "dark" ? "#2b9684" : "#54935b"; // Teal/Green from palette
        }

        // Entity nodes use light gray
        return themeMode === "dark" ? "#6B7280" : "#9CA3AF"; // Tailwind gray-500/gray-400
      },
      [
        labelColorMap,
        nodeDataMap,
        themeMode,
        enableClusterColors,
        clusterColorMap,
      ],
    );

    // Process graph data for Sigma
    const { nodes, edges } = useMemo(() => {
      const nodeMap = new Map<string, any>();
      triplets.forEach((triplet) => {
        if (!nodeMap.has(triplet.source.id)) {
          const nodeColor = getNodeColor(triplet.source);
          const isStatementNode =
            triplet.source.attributes?.nodeType === "Statement" ||
            (triplet.source.labels &&
              triplet.source.labels.includes("Statement"));

          nodeMap.set(triplet.source.id, {
            id: triplet.source.id,
            label: triplet.source.value
              ? triplet.source.value.split(/\s+/).slice(0, 4).join(" ") +
                (triplet.source.value.split(/\s+/).length > 4 ? " ..." : "")
              : "",
            size: isStatementNode ? 4 : 2, // Statement nodes slightly larger
            color: nodeColor,
            x: width,
            y: height,
            nodeData: triplet.source,
            clusterId: triplet.source.clusterId,
            // Enhanced border for visual appeal, thicker for Statement nodes
            borderSize: 1,
            borderColor: nodeColor,
          });
        }
        if (!nodeMap.has(triplet.target.id)) {
          const nodeColor = getNodeColor(triplet.target);
          const isStatementNode =
            triplet.target.attributes?.nodeType === "Statement" ||
            (triplet.target.labels &&
              triplet.target.labels.includes("Statement"));

          nodeMap.set(triplet.target.id, {
            id: triplet.target.id,
            label: triplet.target.value
              ? triplet.target.value.split(/\s+/).slice(0, 4).join(" ") +
                (triplet.target.value.split(/\s+/).length > 4 ? " ..." : "")
              : "",
            size: isStatementNode ? 4 : 2, // Statement nodes slightly larger
            color: nodeColor,
            x: width,
            y: height,
            nodeData: triplet.target,
            clusterId: triplet.target.clusterId,
            // Enhanced border for visual appeal, thicker for Statement nodes
            borderSize: 1,
            borderColor: nodeColor,
          });
        }
      });

      const linkGroups = triplets.reduce(
        (groups, triplet) => {
          if (triplet.relation.type === "_isolated_node_") {
            return groups;
          }
          let key = `${triplet.source.id}-${triplet.target.id}`;
          const reverseKey = `${triplet.target.id}-${triplet.source.id}`;
          if (groups[reverseKey]) {
            key = reverseKey;
          }
          if (!groups[key]) {
            groups[key] = {
              id: key,
              source: triplet.source.id,
              target: triplet.target.id,
              relations: [],
              relationData: [],
              label: "",
              color: "#0000001A",
              labelColor: "#0000001A",
              size: 1,
            };
          }
          groups[key].relations.push(triplet.relation.value);
          groups[key].relationData.push(triplet.relation);

          return groups;
        },
        {} as Record<string, any>,
      );

      return {
        nodes: Array.from(nodeMap.values()),
        edges: Object.values(linkGroups),
      };
    }, [triplets, getNodeColor, width, height]);

    // Helper function to reset highlights without affecting camera
    const resetHighlights = useCallback(() => {
      if (!graphRef.current || !sigmaRef.current) return;
      const graph = graphRef.current;
      const sigma = sigmaRef.current;

      // Store camera state before making changes
      const camera = sigma.getCamera();
      const currentState = camera.getState();

      graph.forEachNode((node) => {
        const nodeData = graph.getNodeAttribute(node, "nodeData");
        const originalColor = getNodeColor(nodeData);
        const isStatementNode =
          nodeData?.attributes.nodeType === "Statement" ||
          (nodeData?.labels && nodeData.labels.includes("Statement"));

        graph.setNodeAttribute(node, "highlighted", false);
        graph.setNodeAttribute(node, "color", originalColor);
        graph.setNodeAttribute(node, "size", isStatementNode ? 4 : 2);
        graph.setNodeAttribute(node, "zIndex", 1);
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, "highlighted", false);
        graph.setEdgeAttribute(edge, "color", "#0000001A");
        graph.setEdgeAttribute(edge, "size", 1);
      });

      // Restore camera state to prevent unwanted movements
      camera.setState(currentState);

      selectedNodeRef.current = null;
      selectedEdgeRef.current = null;
      selectedClusterRef.current = null;
    }, [getNodeColor]);

    // Highlight entire cluster
    const highlightCluster = useCallback(
      (clusterId: string) => {
        if (!graphRef.current || !sigmaRef.current) return;

        const graph = graphRef.current;
        const sigma = sigmaRef.current;

        resetHighlights();
        selectedClusterRef.current = clusterId;

        const clusterNodes: string[] = [];
        const clusterColor =
          clusterColorMap.get(clusterId) || theme.node.selected;

        // Find all nodes in the cluster
        graph.forEachNode((nodeId, attributes) => {
          if (attributes.clusterId === clusterId) {
            clusterNodes.push(nodeId);
            graph.setNodeAttribute(nodeId, "highlighted", true);
            graph.setNodeAttribute(nodeId, "color", clusterColor);
            graph.setNodeAttribute(nodeId, "size", attributes.size * 1.75);
            graph.setNodeAttribute(nodeId, "zIndex", 2);
          } else {
            // Dim other nodes
            graph.setNodeAttribute(nodeId, "color", theme.node.dimmed);
            graph.setNodeAttribute(nodeId, "size", attributes.size * 0.7);
            graph.setNodeAttribute(nodeId, "zIndex", 0);
          }
        });

        // Highlight edges within the cluster
        graph.forEachEdge((edgeId, attributes, source, target) => {
          const sourceInCluster = clusterNodes.includes(source);
          const targetInCluster = clusterNodes.includes(target);

          if (sourceInCluster && targetInCluster) {
            graph.setEdgeAttribute(edgeId, "highlighted", true);
            graph.setEdgeAttribute(edgeId, "color", clusterColor);
            graph.setEdgeAttribute(edgeId, "size", 3);
          } else {
            graph.setEdgeAttribute(edgeId, "color", theme.link.dimmed);
            graph.setEdgeAttribute(edgeId, "size", 1);
          }
        });
      },
      [graphRef, sigmaRef, clusterColorMap, theme, resetHighlights],
    );

    // Zoom to cluster
    const zoomToCluster = useCallback(
      (clusterId: string) => {
        if (!graphRef.current || !sigmaRef.current) return;

        const graph = graphRef.current;
        const sigma = sigmaRef.current;
        const clusterNodes: string[] = [];

        // Find all nodes in the cluster
        graph.forEachNode((nodeId, attributes) => {
          if (attributes.clusterId === clusterId) {
            clusterNodes.push(nodeId);
          }
        });

        if (clusterNodes.length === 0) return;

        // Calculate bounding box of cluster nodes
        let minX = Infinity,
          maxX = -Infinity;
        let minY = Infinity,
          maxY = -Infinity;

        clusterNodes.forEach((nodeId) => {
          const pos = sigma.getNodeDisplayData(nodeId);
          if (pos) {
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
          }
        });

        // Calculate center and zoom level
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          const padding = 100;
          const clusterWidth = maxX - minX + padding;
          const clusterHeight = maxY - minY + padding;
          const ratio = Math.min(
            containerRect.width / clusterWidth,
            containerRect.height / clusterHeight,
            2.0, // Maximum zoom
          );

          sigma
            .getCamera()
            .animate({ x: centerX, y: centerY, ratio }, { duration: 500 });
        }

        highlightCluster(clusterId);
      },
      [highlightCluster],
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      zoomToLinkById: (linkId: string) => {
        // Implementation similar to original graph component
        if (!sigmaRef.current || !graphRef.current) return;
        // ... existing zoomToLinkById logic
      },
      zoomToCluster,
      highlightCluster,
      resetHighlights,
    }));

    // Calculate optimal ForceAtlas2 parameters based on graph properties
    const calculateOptimalParameters = useCallback((graph: GraphologyGraph) => {
      const nodeCount = graph.order;
      const edgeCount = graph.size;

      if (nodeCount === 0)
        return { scalingRatio: 30, gravity: 5, iterations: 600 };

      // Similar logic to original implementation
      const maxPossibleEdges = (nodeCount * (nodeCount - 1)) / 2;
      const density = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;

      let scalingRatio: number;
      if (nodeCount < 10) {
        scalingRatio = 15;
      } else if (nodeCount < 50) {
        scalingRatio = 20 + (nodeCount - 10) * 0.5;
      } else if (nodeCount < 200) {
        scalingRatio = 40 + (nodeCount - 50) * 0.2;
      } else {
        scalingRatio = Math.min(80, 70 + (nodeCount - 200) * 0.05);
      }

      let gravity: number;
      if (density > 0.3) {
        gravity = 1 + density * 2;
      } else if (density > 0.1) {
        gravity = 3 + density * 5;
      } else {
        gravity = Math.min(8, 5 + (1 - density) * 3);
      }

      if (nodeCount < 20) {
        gravity *= 1.5;
      } else if (nodeCount > 100) {
        gravity *= 0.8;
      }

      const complexity = nodeCount + edgeCount;
      let durationSeconds: number;
      if (complexity < 50) {
        durationSeconds = 2.0;
      } else if (complexity < 200) {
        durationSeconds = 3.0;
      } else if (complexity < 500) {
        durationSeconds = 4.0;
      } else {
        durationSeconds = Math.min(8, 5 + (complexity - 500) * 0.006);
      }

      return {
        scalingRatio: Math.round(scalingRatio * 10) / 10,
        gravity: Math.round(gravity * 10) / 10,
        duration: Math.round(durationSeconds * 100) / 100, // in seconds
      };
    }, []);

    useEffect(() => {
      if (isInitializedRef.current || !containerRef.current) return;
      isInitializedRef.current = true;

      // Create graphology graph
      const graph = new GraphologyGraph();
      graphRef.current = graph;

      // Add nodes
      nodes.forEach((node) => {
        graph.addNode(node.id, node);
      });

      // Add edges
      edges.forEach((edge) => {
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          graph.addEdge(edge.source, edge.target, { ...edge });
        }
      });

      // No virtual edges - let the natural graph structure determine layout

      // Apply layout
      if (graph.order > 0) {
        // Strong cluster-based positioning for Statement nodes only
        const clusterNodeMap = new Map<string, string[]>();
        const entityNodes: string[] = [];

        // Group Statement nodes by their cluster ID, separate Entity nodes
        graph.forEachNode((nodeId, attributes) => {
          const isStatementNode =
            attributes.nodeData?.nodeType === "Statement" ||
            (attributes.nodeData?.labels &&
              attributes.nodeData.labels.includes("Statement"));

          if (isStatementNode && attributes.clusterId) {
            // Statement nodes with cluster IDs go into clusters
            if (!clusterNodeMap.has(attributes.clusterId)) {
              clusterNodeMap.set(attributes.clusterId, []);
            }
            clusterNodeMap.get(attributes.clusterId)!.push(nodeId);
          } else {
            // Entity nodes (or unclustered nodes) positioned separately
            entityNodes.push(nodeId);
          }
        });

        const clusterIds = Array.from(clusterNodeMap.keys());

        if (clusterIds.length > 0) {
          // Use a more aggressive clustering approach - create distinct regions
          const padding = Math.min(width, height) * 0.1; // 10% padding
          const availableWidth = width - 2 * padding;
          const availableHeight = height - 2 * padding;

          // Calculate optimal grid layout
          const cols = Math.ceil(Math.sqrt(clusterIds.length));
          const rows = Math.ceil(clusterIds.length / cols);
          const cellWidth = availableWidth / cols;
          const cellHeight = availableHeight / rows;

          clusterIds.forEach((clusterId, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);

            // Calculate cluster region with more separation
            const regionLeft = padding + col * cellWidth;
            const regionTop = padding + row * cellHeight;
            const regionCenterX = regionLeft + cellWidth / 2;
            const regionCenterY = regionTop + cellHeight / 2;

            // Get nodes in this cluster
            const nodesInCluster = clusterNodeMap.get(clusterId)!;
            const clusterSize = nodesInCluster.length;

            // Create cluster radius with Marvel-style spacing - more generous
            const maxRadius = Math.min(cellWidth, cellHeight) * 0.35;
            const baseSpacing = 150; // Larger base spacing between nodes
            const clusterRadius = Math.max(
              baseSpacing,
              Math.min(maxRadius, Math.sqrt(clusterSize) * baseSpacing * 1.2),
            );

            if (clusterSize === 1) {
              // Single node at region center
              graph.setNodeAttribute(nodesInCluster[0], "x", regionCenterX);
              graph.setNodeAttribute(nodesInCluster[0], "y", regionCenterY);
            } else if (clusterSize <= 6) {
              // Small clusters - tight circle
              nodesInCluster.forEach((nodeId, nodeIndex) => {
                const angle = (nodeIndex / clusterSize) * 2 * Math.PI;
                const x = regionCenterX + Math.cos(angle) * clusterRadius;
                const y = regionCenterY + Math.sin(angle) * clusterRadius;
                graph.setNodeAttribute(nodeId, "x", x);
                graph.setNodeAttribute(nodeId, "y", y);
              });
            } else {
              // Larger clusters - dense spiral pattern
              nodesInCluster.forEach((nodeId, nodeIndex) => {
                const spiralTurns = Math.ceil(clusterSize / 8);
                const angle =
                  (nodeIndex / clusterSize) * 2 * Math.PI * spiralTurns;
                const radius = (nodeIndex / clusterSize) * clusterRadius;
                const x = regionCenterX + Math.cos(angle) * radius;
                const y = regionCenterY + Math.sin(angle) * radius;
                graph.setNodeAttribute(nodeId, "x", x);
                graph.setNodeAttribute(nodeId, "y", y);
              });
            }
          });
        }

        // Position Entity nodes using ForceAtlas2 natural positioning
        // They will be positioned by the algorithm based on their connections to Statement nodes
        entityNodes.forEach((nodeId) => {
          // Give them initial random positions, ForceAtlas2 will adjust based on connections
          graph.setNodeAttribute(nodeId, "x", Math.random() * width);
          graph.setNodeAttribute(nodeId, "y", Math.random() * height);
        });

        const optimalParams = calculateOptimalParameters(graph);
        const settings = forceAtlas2.inferSettings(graph);

        const layout = new FA2Layout(graph, {
          settings: {
            ...settings,
            barnesHutOptimize: true,
            strongGravityMode: false, // Marvel doesn't use strong gravity
            gravity: Math.max(0.1, optimalParams.gravity * 0.005), // Much weaker gravity like Marvel
            scalingRatio: optimalParams.scalingRatio * 10, // Higher scaling for more spacing
            slowDown: 20, // Much slower to preserve cluster positions
            outboundAttractionDistribution: false, // Use standard distribution
            linLogMode: false, // Linear mode
            edgeWeightInfluence: 0, // Disable edge weight influence to maintain positioning
          },
        });

        layout.start();
        setTimeout(() => layout.stop(), (optimalParams.duration ?? 2) * 1000);
      }

      // Create Sigma instance
      const sigma = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: true,
        defaultEdgeColor: "#0000001A",
        defaultNodeColor: theme.node.fill,
        defaultEdgeType: "edges-fast",
        edgeProgramClasses: {
          "edges-fast": EdgeLineProgram,
        },
        renderLabels: false,
        enableEdgeEvents: true,
        minCameraRatio: 0.01,
        defaultDrawNodeHover: drawHover,

        maxCameraRatio: 2,
        allowInvalidContainer: false,
      });

      sigmaRef.current = sigma;

      // Set up camera for zoom on mount
      if (zoomOnMount) {
        setTimeout(() => {
          sigma
            .getCamera()
            .animate(sigma.getCamera().getState(), { duration: 750 });
        }, 100);
      }

      // Update cluster labels after any camera movement
      sigma.getCamera().on("updated", () => {
        if (showClusterLabels) {
        }
      });

      // Drag and drop implementation (same as original)
      let draggedNode: string | null = null;
      let isDragging = false;

      sigma.on("downNode", (e) => {
        isDragging = true;
        draggedNode = e.node;
        graph.setNodeAttribute(draggedNode, "highlighted", true);
        if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
      });

      sigma.on("moveBody", ({ event }) => {
        if (!isDragging || !draggedNode) return;
        const pos = sigma.viewportToGraph(event);
        graph.setNodeAttribute(draggedNode, "x", pos.x);
        graph.setNodeAttribute(draggedNode, "y", pos.y);
        event.preventSigmaDefault?.();
        event.original?.preventDefault?.();
        event.original?.stopPropagation?.();
      });

      const handleUp = () => {
        if (draggedNode) {
          graph.removeNodeAttribute(draggedNode, "highlighted");
        }
        isDragging = false;
        draggedNode = null;
      };
      sigma.on("upNode", handleUp);
      sigma.on("upStage", handleUp);

      // Node click handler
      sigma.on("clickNode", (event) => {
        const { node } = event;

        // Store current camera state to prevent unwanted movements
        const camera = sigma.getCamera();
        const currentState = camera.getState();

        resetHighlights(); // Clear previous highlights first

        // Restore camera state after reset to prevent zoom changes
        setTimeout(() => {
          camera.setState(currentState);
        }, 0);

        if (onNodeClick) {
          onNodeClick(node);
        }

        // Highlight the clicked node
        graph.setNodeAttribute(node, "highlighted", true);
        graph.setNodeAttribute(node, "color", theme.node.selected);
        graph.setNodeAttribute(
          node,
          "size",
          graph.getNodeAttribute(node, "size"),
        );
        // Enhanced border for selected node
        graph.setNodeAttribute(node, "borderSize", 3);
        graph.setNodeAttribute(node, "borderColor", theme.node.selected);
        graph.setNodeAttribute(node, "zIndex", 3);
        selectedNodeRef.current = node;

        // Highlight connected edges and nodes
        graph.forEachEdge(node, (edge, _attributes, source, target) => {
          graph.setEdgeAttribute(edge, "highlighted", true);
          graph.setEdgeAttribute(edge, "color", theme.link.selected);
          graph.setEdgeAttribute(edge, "size", 2);
          const otherNode = source === node ? target : source;
          graph.setNodeAttribute(otherNode, "highlighted", true);
          graph.setNodeAttribute(otherNode, "color", theme.node.hover);
          graph.setNodeAttribute(
            otherNode,
            "size",
            graph.getNodeAttribute(otherNode, "size"),
          );
          graph.setNodeAttribute(otherNode, "zIndex", 2);
        });
      });

      // Edge click handler
      sigma.on("clickEdge", (event) => {
        const { edge } = event;
        resetHighlights();
        const edgeAttrs = graph.getEdgeAttributes(edge);
        if (edgeAttrs.relationData && edgeAttrs.relationData.length > 0) {
          const relation = edgeAttrs.relationData[0];
          if (onEdgeClick) {
            onEdgeClick(relation.id);
          }
        }
        graph.setEdgeAttribute(edge, "highlighted", true);
        graph.setEdgeAttribute(edge, "color", theme.link.selected);
        selectedEdgeRef.current = edge;
        const source = graph.source(edge);
        const target = graph.target(edge);
        graph.setNodeAttribute(source, "highlighted", true);
        graph.setNodeAttribute(source, "color", theme.node.selected);
        graph.setNodeAttribute(target, "highlighted", true);
        graph.setNodeAttribute(target, "color", theme.node.selected);
      });

      // Background click handler
      sigma.on("clickStage", (event) => {
        // Store camera state before reset
        const camera = sigma.getCamera();
        const currentState = camera.getState();

        resetHighlights();

        // Restore camera state
        camera.setState(currentState);

        if (onBlur) {
          onBlur();
        }
      });

      // Cleanup function
      return () => {
        if (sigmaRef.current) {
          sigmaRef.current.kill();
          sigmaRef.current = null;
        }
        if (graphRef.current) {
          graphRef.current.clear();
          graphRef.current = null;
        }
        if (clustersLayerRef.current) {
          clustersLayerRef.current.remove();
          clustersLayerRef.current = null;
        }
        isInitializedRef.current = false;
      };
    }, [nodes, edges, clusters, showClusterLabels]);

    return (
      <div
        ref={containerRef}
        className=""
        style={{
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: "8px",
          cursor: "grab",
          fontSize: "12px",
          position: "relative",
        }}
      />
    );
  },
);

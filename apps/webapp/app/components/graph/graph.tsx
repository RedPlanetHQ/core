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
} from "./node-colors";
import { useTheme } from "remix-themes";

interface GraphProps {
  triplets: GraphTriplet[];
  width?: number;
  height?: number;
  zoomOnMount?: boolean;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onBlur?: () => void;
  labelColorMap?: Map<string, number>;
}

export interface GraphRef {
  zoomToLinkById: (linkId: string) => void;
}

export const Graph = forwardRef<GraphRef, GraphProps>(
  (
    {
      triplets,
      width = 1000,
      height = 800,
      zoomOnMount = false,
      onNodeClick,
      onEdgeClick,
      onBlur,
      labelColorMap: externalLabelColorMap,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sigmaRef = useRef<Sigma | null>(null);
    const graphRef = useRef<GraphologyGraph | null>(null);
    const [themeMode] = useTheme();

    const isInitializedRef = useRef(false);
    const selectedNodeRef = useRef<string | null>(null);
    const selectedEdgeRef = useRef<string | null>(null);

    // Memoize theme to prevent unnecessary recreation
    const theme = useMemo(
      () => ({
        node: {
          fill: colors.pink[500],
          stroke: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          hover: colors.blue[400],
          text: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          selected: colors.blue[500],
          dimmed: colors.pink[300],
        },
        link: {
          stroke: colors.gray[400],
          selected: colors.blue[400],
          dimmed: themeMode === "dark" ? colors.slate[800] : colors.slate[200],
          label: {
            bg: themeMode === "dark" ? colors.slate[800] : colors.slate[200],
            text: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
          },
        },
        background:
          themeMode === "dark" ? colors.slate[900] : colors.slate[100],
        controls: {
          bg: themeMode === "dark" ? colors.slate[800] : colors.slate[200],
          hover: themeMode === "dark" ? colors.slate[700] : colors.slate[300],
          text: themeMode === "dark" ? colors.slate[100] : colors.slate[900],
        },
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

    // Function to get node color
    const getNodeColor = useCallback(
      (node: any): string => {
        if (!node) {
          return getNodeColorByLabel(null, themeMode === "dark", labelColorMap);
        }
        const nodeData = nodeDataMap.get(node.id) || node;
        const primaryLabel = nodeData.primaryLabel;
        return getNodeColorByLabel(
          primaryLabel,
          themeMode === "dark",
          labelColorMap,
        );
      },
      [labelColorMap, nodeDataMap, themeMode],
    );

    // Process graph data for Sigma
    const { nodes, edges } = useMemo(() => {
      const nodeMap = new Map<string, any>();
      triplets.forEach((triplet) => {
        if (!nodeMap.has(triplet.source.id)) {
          nodeMap.set(triplet.source.id, {
            id: triplet.source.id,
            label: triplet.source.value,
            size: 5,
            color: getNodeColor(triplet.source),
            x: width,
            y: height,
            nodeData: triplet.source,
          });
        }
        if (!nodeMap.has(triplet.target.id)) {
          nodeMap.set(triplet.target.id, {
            id: triplet.target.id,
            label: triplet.target.value,
            size: 5,
            color: getNodeColor(triplet.target),
            x: width,
            y: height,
            nodeData: triplet.target,
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
    }, [triplets, getNodeColor, theme.link.stroke, width, height]);

    // Helper function to reset highlights
    const resetHighlights = useCallback(() => {
      if (!graphRef.current) return;
      const graph = graphRef.current;
      graph.forEachNode((node) => {
        graph.setNodeAttribute(node, "highlighted", false);
        graph.setNodeAttribute(
          node,
          "color",
          getNodeColor(graph.getNodeAttribute(node, "nodeData")),
        );
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, "highlighted", false);
        graph.setEdgeAttribute(edge, "color", "#0000001A");
      });
      selectedNodeRef.current = null;
      selectedEdgeRef.current = null;
    }, [getNodeColor, theme.link.stroke]);

    // Add ref for zoomToLinkById
    const graphRefMethods = useRef<GraphRef>({
      zoomToLinkById: (linkId: string) => {
        if (!sigmaRef.current || !graphRef.current) return;
        try {
          const graph = graphRef.current;
          const sigma = sigmaRef.current;
          const edge = graph.findEdge((edgeId, attrs) => {
            return attrs.relationData?.some(
              (rel: IdValue) => rel.id === linkId,
            );
          });
          if (edge) {
            const edgeAttrs = graph.getEdgeAttributes(edge);
            const source = graph.source(edge);
            const target = graph.target(edge);
            resetHighlights();
            graph.setEdgeAttribute(edge, "highlighted", true);
            graph.setNodeAttribute(source, "highlighted", true);
            graph.setNodeAttribute(target, "highlighted", true);
            const relation = edgeAttrs.relationData?.find(
              (rel: IdValue) => rel.id === linkId,
            );
            if (relation && onEdgeClick) {
              onEdgeClick(relation.id);
            }
            const sourcePos = sigma.getNodeDisplayData(source);
            const targetPos = sigma.getNodeDisplayData(target);
            if (sourcePos && targetPos) {
              const centerX = (sourcePos.x + targetPos.x) / 2;
              const centerY = (sourcePos.y + targetPos.y) / 2;
              sigma
                .getCamera()
                .animate(
                  { x: centerX, y: centerY, ratio: 0.5 },
                  { duration: 500 },
                );
            }
          } else {
            console.warn(`Link with id ${linkId} not found`);
          }
        } catch (error) {
          console.error("Error in zoomToLinkById:", error);
        }
      },
    });

    useImperativeHandle(ref, () => graphRefMethods.current);

    // Calculate optimal ForceAtlas2 parameters based on graph properties
    const calculateOptimalParameters = useCallback((graph: GraphologyGraph) => {
      const nodeCount = graph.order;
      const edgeCount = graph.size;

      if (nodeCount === 0)
        return { scalingRatio: 30, gravity: 5, iterations: 600 };

      // Calculate graph density (0 to 1)
      const maxPossibleEdges = (nodeCount * (nodeCount - 1)) / 2;
      const density = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;

      // Calculate optimal scaling ratio based on node count
      // More nodes = need more space to prevent overcrowding
      let scalingRatio: number;
      if (nodeCount < 10) {
        scalingRatio = 20; // Slightly wider for small graphs
      } else if (nodeCount < 50) {
        scalingRatio = 30 + (nodeCount - 10) * 1.0; // Faster increase
      } else if (nodeCount < 200) {
        scalingRatio = 70 + (nodeCount - 50) * 0.5; // More spread
      } else if (nodeCount < 500) {
        scalingRatio = 145 + (nodeCount - 200) * 0.3; // Continue spreading
      } else {
        scalingRatio = Math.min(300, 235 + (nodeCount - 500) * 0.1); // Cap at 300
      }

      // Calculate optimal gravity based on density and node count
      let gravity: number;
      if (density > 0.3) {
        // Dense graphs need less gravity to prevent overcrowding
        gravity = 0.5 + density * 1.5;
      } else if (density > 0.1) {
        // Medium density graphs
        gravity = 2 + density * 3;
      } else {
        // Sparse graphs need more gravity to keep components together
        gravity = Math.min(6, 4 + (1 - density) * 2);
      }

      // Adjust gravity based on node count - more aggressive reduction for large graphs
      if (nodeCount < 20) {
        gravity *= 1.5; // Smaller graphs benefit from stronger gravity
      } else if (nodeCount > 100) {
        gravity *= 0.5; // Larger graphs need much gentler gravity
      } else if (nodeCount > 200) {
        gravity *= 0.3; // Very large graphs need very gentle gravity
      }

      // Calculate iterations based on complexity
      const complexity = nodeCount + edgeCount;
      let iterations: number;
      if (complexity < 500) {
        iterations = complexity;
      } else {
        iterations = Math.min(600, 500 + complexity * 0.2);
      }

      return {
        scalingRatio: Math.round(scalingRatio * 10) / 10,
        gravity: Math.round(gravity * 10) / 10,
        iterations: 10,
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

      // Apply layout
      if (graph.order > 0) {
        graph.forEachNode((node) => {
          graph.setNodeAttribute(node, "x", width);
          graph.setNodeAttribute(node, "y", height);
        });

        // const layout = new ForceSupervisor(graph, {
        //   isNodeFixed: (_, attr) => attr.highlighted,
        // });
        // layout.start();

        // Calculate optimal parameters for this graph
        const optimalParams = calculateOptimalParameters(graph);

        const settings = forceAtlas2.inferSettings(graph);
        const fa2Layout = new FA2Layout(graph, {
          settings: settings,
        });

        forceAtlas2.assign(graph, {
          iterations: optimalParams.iterations,
          settings: {
            ...settings,
            barnesHutOptimize: true,
            strongGravityMode: false, // Disable strong gravity for more spread
            gravity: optimalParams.gravity,
            scalingRatio: optimalParams.scalingRatio,
            slowDown: 1.5, // Reduced slowDown for better spreading
          },
        });

        // noverlap.assign(graph, {
        //   maxIterations: 200,
        //   settings: {
        //     margin: 10,
        //     expansion: 1.5,
        //     gridSize: 30,
        //   },
        // });
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
        enableEdgeEvents: true,
        minCameraRatio: 0.1,
        maxCameraRatio: 2,
        allowInvalidContainer: true,
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

      // --- Drag and Drop Implementation ---
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

      // --- End Drag and Drop ---

      // Node click handler
      sigma.on("clickNode", (event) => {
        const { node } = event;
        // resetHighlights();
        if (onNodeClick) {
          onNodeClick(node);
        }
        graph.setNodeAttribute(node, "highlighted", true);
        graph.setNodeAttribute(node, "color", theme.node.selected);
        selectedNodeRef.current = node;
        graph.forEachEdge(node, (edge, _attributes, source, target) => {
          graph.setEdgeAttribute(edge, "highlighted", true);
          graph.setEdgeAttribute(edge, "color", theme.link.selected);
          const otherNode = source === node ? target : source;
          graph.setNodeAttribute(otherNode, "highlighted", true);
          graph.setNodeAttribute(otherNode, "color", theme.node.selected);
        });
        // const nodePosition = sigma.getNodeDisplayData(node);
        // if (nodePosition) {
        //   sigma
        //     .getCamera()
        //     .animate(
        //       { x: nodePosition.x, y: nodePosition.y, ratio: 0.5 },
        //       { duration: 500 },
        //     );
        // }
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
        const sourcePos = sigma.getNodeDisplayData(source);
        const targetPos = sigma.getNodeDisplayData(target);
        if (sourcePos && targetPos) {
          const centerX = (sourcePos.x + targetPos.x) / 2;
          const centerY = (sourcePos.y + targetPos.y) / 2;
          // sigma
          //   .getCamera()
          //   .animate({ x: centerX, y: centerY, ratio: 0.5 }, { duration: 500 });
        }
      });

      // Background click handler
      sigma.on("clickStage", () => {
        resetHighlights();
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
        isInitializedRef.current = false;
      };
    }, [nodes, edges]);

    return (
      <div
        ref={containerRef}
        className=""
        style={{
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: "8px",
          cursor: "grab",
        }}
      />
    );
  },
);

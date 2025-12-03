export interface Node {
  uuid: string;
  summary?: string;
  labels?: string[];
  attributes?: Record<string, any>;
  createdAt: string;
  clusterId?: string;
}

export interface Edge {
  uuid: string;
  source_node_uuid: string;
  target_node_uuid: string;
  type: string;
  createdAt: string;
  attributes?: Record<string, any>;
}

export interface RawTriplet {
  sourceNode: Node;
  edge: Edge;
  targetNode: Node;
}

export interface GraphNode extends Node {
  id: string;
  value: string;
  primaryLabel?: string;
  clusterId?: string; // Add cluster information
}

export interface GraphEdge extends Edge {
  id: string;
  value: string;
}

export interface GraphTriplet {
  source: GraphNode;
  relation: GraphEdge;
  target: GraphNode;
}

export interface IdValue {
  id: string;
  value: string;
}

// Graph visualization types
export interface GraphNode extends Node {
  id: string;
  value: string;
}

export interface GraphEdge extends Edge {
  id: string;
  value: string;
}

export interface GraphTriplet {
  source: GraphNode;
  relation: GraphEdge;
  target: GraphNode;
}

// Popup content types for UI
export interface NodePopupContent {
  id: string;
  node: Node;
}

export interface EdgePopupContent {
  id: string;
  source: Node;
  relation: Edge;
  target: Node;
}

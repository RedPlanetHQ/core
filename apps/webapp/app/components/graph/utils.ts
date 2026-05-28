import type {
  Node,
  Edge,
  GraphNode,
  GraphEdge,
  RawTriplet,
  GraphTriplet,
} from "./type";

export function toGraphNode(node: Node): GraphNode {
  const primaryLabel =
    node.labels?.find((label) => label != "Entity") || "Entity";

  return {
    id: node.uuid,
    value: node.name ?? node.uuid,
    uuid: node.uuid,
    name: node.name,
    createdAt: node.createdAt,
    attributes: node.attributes,
    summary: node.summary,
    labels: node.labels,
    primaryLabel,
    clusterId: node?.clusterId, // Extract cluster ID from attributes
  };
}

export function toGraphEdge(edge: Edge): GraphEdge {
  return {
    id: edge.uuid,
    value: edge.type,
    ...edge,
  };
}

export function toGraphTriplet(triplet: RawTriplet): GraphTriplet {
  return {
    source: toGraphNode(triplet.sourceNode),
    relation: toGraphEdge(triplet.edge),
    target: toGraphNode(triplet.targetNode),
  };
}

export function toGraphTriplets(triplets: RawTriplet[]): GraphTriplet[] {
  return triplets.map(toGraphTriplet);
}

export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

const TEXT_COLOR = "#000000";

export function drawHover(
  context: CanvasRenderingContext2D,
  data: any,
  settings: any,
) {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  const subLabelSize = size - 2;

  const label = data.label;
  const subLabel = data.tag !== "unknown" ? data.tag : "";
  const entityLabel = data.nodeData.attributes.nodeType;

  // Simulate the --shadow-1 Tailwind shadow:
  // lch(0 0 0 / 0.022) 0px 3px 6px -2px, lch(0 0 0 / 0.044) 0px 1px 1px;
  // Canvas only supports a single shadow, so we approximate with the stronger one.
  // lch(0 0 0 / 0.044) is roughly rgba(0,0,0,0.044)
  context.beginPath();
  context.fillStyle = "#fff";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 1;
  context.shadowBlur = 1;
  context.shadowColor = "rgba(0,0,0,0.044)";

  context.font = `${weight} ${size}px ${font}`;
  const labelWidth = context.measureText(label).width;
  context.font = `${weight} ${subLabelSize}px ${font}`;
  const subLabelWidth = subLabel ? context.measureText(subLabel).width : 0;
  context.font = `${weight} ${subLabelSize}px ${font}`;
  const entityLabelWidth = entityLabel
    ? context.measureText(entityLabel).width
    : 0;

  const textWidth = Math.max(labelWidth, subLabelWidth, entityLabelWidth);

  const x = Math.round(data.x);
  const y = Math.round(data.y);
  const w = Math.round(textWidth + size / 2 + data.size + 3);
  const hLabel = Math.round(size / 2 + 4);
  const hSubLabel = subLabel ? Math.round(subLabelSize / 2 + 9) : 0;
  const hentityLabel = Math.round(subLabelSize / 2 + 9);

  drawRoundRect(
    context,
    x,
    y - hSubLabel - 12,
    w,
    hentityLabel + hLabel + hSubLabel + 12,
    5,
  );
  context.closePath();
  context.fill();

  // Remove shadow for text
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 0;
  context.shadowColor = "transparent";

  // And finally we draw the labels
  context.fillStyle = TEXT_COLOR;
  context.font = `${weight} ${size}px ${font}`;
  context.fillText(label, data.x + data.size + 3, data.y + size / 3);

  if (subLabel) {
    context.fillStyle = TEXT_COLOR;
    context.font = `${weight} ${subLabelSize}px ${font}`;
    context.fillText(
      subLabel,
      data.x + data.size + 3,
      data.y - (2 * size) / 3 - 2,
    );
  }

  context.fillStyle = data.color;
  context.font = `${weight} ${subLabelSize}px ${font}`;
  context.fillText(
    entityLabel,
    data.x + data.size + 3,
    data.y + size / 3 + 3 + subLabelSize,
  );
}

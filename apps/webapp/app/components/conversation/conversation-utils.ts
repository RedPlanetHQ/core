import type { UIMessagePart } from "ai";

/**
 * Maps tool types to user-friendly display names
 */
export const getToolDisplayName = (toolType: string): string => {
  const name = toolType.replace("tool-", "");

  const displayNameMap: Record<string, string> = {
    gather_context: "Gather context",
    take_action: "Take action",
    integration_query: "Integration explorer",
    integration_action: "Integration explorer",
    memory_search: "Memory explorer",
    execute_integration_action: "Execute integration action",
    get_integration_actions: "Get integration actions",
  };

  // Check for exact match
  if (displayNameMap[name]) {
    return displayNameMap[name];
  }

  // Check for gateway_ prefix
  if (name.startsWith("gateway_")) {
    const gatewayName = name.replace("gateway_", "").replace(/_/g, " ");
    return `Gateway: ${gatewayName.charAt(0).toUpperCase() + gatewayName.slice(1)}`;
  }

  // Default: convert snake_case to Title Case
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/**
 * Helper to get nested parts from output (checks both .content and .parts)
 */
const getNestedParts = (output: any): any[] => {
  if (!output) return [];
  // Check output.parts first (sub-agent response structure)
  if (output.parts && Array.isArray(output.parts)) {
    return output.parts;
  }
  // Fallback to output.content
  if (output.content && Array.isArray(output.content)) {
    return output.content;
  }
  return [];
};

/**
 * Recursively checks if any nested part has state "approval-requested"
 */
export const hasNeedsApprovalDeep = (parts: UIMessagePart[]): boolean => {
  for (const part of parts) {
    const p = part as any;
    if (p.state === "approval-requested") return true;
    // Check nested output (sub-agent tool parts)
    const nestedParts = getNestedParts(p.output);
    if (nestedParts.length > 0) {
      if (hasNeedsApprovalDeep(nestedParts)) return true;
    }
  }
  return false;
};

/**
 * Recursively collects all tool parts from nested structure (flattened)
 */
export const findAllToolsDeep = (parts: UIMessagePart[]): any[] => {
  const tools: any[] = [];

  const traverse = (partList: any[]) => {
    for (const part of partList) {
      if (part.type?.includes("tool-")) {
        tools.push(part);
      }
      // Traverse nested output (sub-agent tool parts)
      const nestedParts = getNestedParts(part.output);
      if (nestedParts.length > 0) {
        traverse(nestedParts);
      }
    }
  };

  traverse(parts);
  return tools;
};

/**
 * Finds the index of the first tool with "approval-requested" state in flattened list
 * Returns -1 if none found
 */
export const findFirstPendingApprovalIndex = (parts: UIMessagePart[]): number => {
  const allTools = findAllToolsDeep(parts);
  return allTools.findIndex((part) => part.state === "approval-requested");
};

/**
 * Checks if a specific tool should be disabled based on pending approvals
 * A tool is disabled if there's a pending approval before it in the flattened order
 */
export const isToolDisabled = (
  part: any,
  allPartsFlat: any[],
  firstPendingIndex: number
): boolean => {
  if (firstPendingIndex === -1) return false;
  const toolIndex = allPartsFlat.indexOf(part);
  return (
    toolIndex > firstPendingIndex && part.state === "approval-requested"
  );
};

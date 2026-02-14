import type { UIMessagePart } from "ai";

/**
 * Recursively checks if any nested part has state "approval-requested"
 */
export const hasNeedsApprovalDeep = (parts: UIMessagePart[]): boolean => {
  for (const part of parts) {
    const p = part as any;
    if (p.state === "approval-requested") return true;
    // Check nested output content (sub-agent tool parts)
    if (p.output?.content && Array.isArray(p.output.content)) {
      if (hasNeedsApprovalDeep(p.output.content)) return true;
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
      // Traverse nested output content (sub-agent tool parts)
      if (part.output?.content && Array.isArray(part.output.content)) {
        traverse(part.output.content);
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

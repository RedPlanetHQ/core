import type { UIMessagePart } from "ai";

// ── Mastra data structures ────────────────────────────────────────────────────

export interface SubAgentToolResult {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface MastraToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  payload?: MastraToolCall;
  providerMetadata?: unknown;
}

export interface MastraToolResult {
  toolCallId: string;
  result?: unknown;
  payload?: MastraToolResult;
}

export interface MastraStep {
  toolCalls?: MastraToolCall[];
  toolResults?: MastraToolResult[];
  text?: string;
  steps?: MastraStep[];
}

export interface AgentOutput {
  parts?: unknown[];
  content?: unknown[];
  toolCalls?: MastraToolCall[];
  toolResults?: MastraToolResult[];
  steps?: MastraStep[];
  text?: string;
  subAgentToolResults?: SubAgentToolResult[];
  subAgentResourceId?: string;
  subAgentThreadId?: string;
}

// ── Tool part / state ─────────────────────────────────────────────────────────

export type ToolPartState =
  // AI SDK v6 states
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  // approval middleware states
  | "approval-requested"
  | "approval-responded"
  // synthetic states used in our nested parts (built by getNestedPartsFromOutput)
  | "in-progress"
  | "output-denied";

export interface ConversationToolPart {
  type: string;
  toolCallId: string;
  toolName?: string;
  state: ToolPartState;
  input: Record<string, unknown>;
  output?: unknown;
  approval?: { id: string };
}

// ── Extended part / group types ───────────────────────────────────────────────

export interface StepStartPart {
  type: "step-start";
}

export interface DataToolAgentPart extends Partial<AgentOutput> {
  type: "data-tool-agent" | "tool-agent";
  data?: Partial<AgentOutput>;
  id?: string;
}

export interface AgentToolPart extends ConversationToolPart {
  output: AgentOutput;
}

export type ExtendedPart =
  | UIMessagePart
  | StepStartPart
  | DataToolAgentPart
  | AgentToolPart;

export interface GroupedPart {
  type: "tool-group" | "single";
  parts: ExtendedPart[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ── getNestedPartsFromOutput ──────────────────────────────────────────────────

/**
 * Extracts nested ConversationToolPart / text parts from an agent output.
 * Handles three formats:
 *  1. output.parts / output.content  (array already in the right shape)
 *  2. Mastra streaming: { toolCalls, toolResults, steps }
 *  3. output-available: { subAgentToolResults }
 */
export const getNestedPartsFromOutput = (
  output: unknown,
): Array<ConversationToolPart | { type: "text"; text: string }> => {
  if (!isObject(output)) return [];

  // Format 1a: .parts
  if (Array.isArray(output.parts)) {
    return output.parts.filter(
      (p): p is ConversationToolPart =>
        isObject(p) && typeof p.state === "string",
    );
  }

  // Format 1b: .content
  if (Array.isArray(output.content)) {
    return output.content.filter(
      (p): p is ConversationToolPart =>
        isObject(p) && typeof p.state === "string",
    );
  }

  // Format 2: Mastra streaming { toolCalls, toolResults, steps }
  if (output.toolCalls || output.toolResults || output.steps) {
    const parts: Array<ConversationToolPart | { type: "text"; text: string }> =
      [];

    // Use the latest step's data if available, otherwise top-level
    const steps = Array.isArray(output.steps)
      ? (output.steps as MastraStep[])
      : [];
    const source: AgentOutput | MastraStep =
      steps.length > 0 ? steps[steps.length - 1] : (output as AgentOutput);

    // Merge tool calls from the latest step AND the top-level output so that
    // calls emitted at the stream level but not yet reflected in a step are
    // still rendered (e.g. execute_integration_action requested mid-stream).
    const stepCalls: MastraToolCall[] = source.toolCalls ?? [];
    const outputCalls: MastraToolCall[] =
      steps.length > 0 ? ((output as AgentOutput).toolCalls ?? []) : [];
    const stepCallIds = new Set(
      stepCalls.map((tc) => ((tc as MastraToolCall).payload ?? tc).toolCallId),
    );
    const mergedCalls: MastraToolCall[] = [
      ...stepCalls,
      ...outputCalls.filter(
        (tc) =>
          !stepCallIds.has(((tc as MastraToolCall).payload ?? tc).toolCallId),
      ),
    ];

    // Merge results from the latest step AND the top-level output.
    // Using ?? alone misses results that exist at output level when the step
    // already has a (partial) toolResults array.
    const stepResults: MastraToolResult[] = source.toolResults ?? [];
    const outputResults: MastraToolResult[] =
      steps.length > 0 ? ((output as AgentOutput).toolResults ?? []) : [];
    const stepResultIds = new Set(
      stepResults.map((r) => (r.payload ?? r).toolCallId),
    );
    const allResults: MastraToolResult[] = [
      ...stepResults,
      ...outputResults.filter(
        (r) => !stepResultIds.has((r.payload ?? r).toolCallId),
      ),
    ];

    const seenCallIds = new Set<string>();
    for (const tc of mergedCalls) {
      const call: MastraToolCall = (tc as MastraToolCall).payload ?? tc;
      if (seenCallIds.has(call.toolCallId)) continue;
      seenCallIds.add(call.toolCallId);

      const tr = allResults.find((r) => {
        const result: MastraToolResult = r.payload ?? r;
        return result.toolCallId === call.toolCallId;
      });
      const result: MastraToolResult | undefined = tr?.payload ?? tr;

      parts.push({
        type: `tool-${call.toolName}`,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        state:
          result?.result !== undefined ? "output-available" : "in-progress",
        input: call.args,
        ...(result?.result !== undefined && { output: result.result }),
      });
    }

    const text = source.text ?? (output as AgentOutput).text;
    if (text) {
      parts.push({ type: "text", text });
    }
    return parts;
  }

  // Format 3: output-available { subAgentToolResults }
  if (Array.isArray(output.subAgentToolResults)) {
    const parts: Array<ConversationToolPart | { type: "text"; text: string }> =
      [];
    const seenCallIds = new Set<string>();
    for (const tr of output.subAgentToolResults as SubAgentToolResult[]) {
      if (seenCallIds.has(tr.toolCallId)) continue;
      seenCallIds.add(tr.toolCallId);
      parts.push({
        type: `tool-${tr.toolName}`,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        state: tr.result !== undefined ? "output-available" : "in-progress",
        input: tr.args,
        ...(tr.result !== undefined && { output: tr.result }),
      });
    }
    if (typeof output.text === "string") {
      parts.push({ type: "text", text: output.text });
    }
    return parts;
  }

  return [];
};

// ── hasNeedsApprovalDeep ──────────────────────────────────────────────────────

/**
 * Recursively checks if any nested part has state "approval-requested"
 */
export const hasNeedsApprovalDeep = (
  parts: ConversationToolPart[],
): boolean => {
  for (const part of parts) {
    if (part.state === "approval-requested") return true;
    const nested = getNestedPartsFromOutput(part.output);
    const toolParts = nested.filter((p): p is ConversationToolPart =>
      p.type.includes("tool-"),
    );
    if (toolParts.length > 0 && hasNeedsApprovalDeep(toolParts)) return true;
  }
  return false;
};

// ── findAllToolsDeep ──────────────────────────────────────────────────────────

/**
 * Recursively collects all tool parts from nested structure (flattened)
 */
export const findAllToolsDeep = (
  parts: ExtendedPart[],
): ConversationToolPart[] => {
  const tools: ConversationToolPart[] = [];

  const traverse = (
    partList: Array<
      ExtendedPart | ConversationToolPart | { type: "text"; text: string }
    >,
  ) => {
    for (const p of partList) {
      const type = (p as { type?: string }).type;
      if (typeof type !== "string" || !type.includes("tool-")) continue;
      const toolPart = p as unknown as ConversationToolPart;
      tools.push(toolPart);
      const nested = getNestedPartsFromOutput(toolPart.output);
      if (nested.length > 0) traverse(nested);
    }
  };

  traverse(parts);
  return tools;
};

// ── findFirstPendingApprovalIndex ─────────────────────────────────────────────

/**
 * Finds the index of the first tool with "approval-requested" state in flattened list.
 * Returns -1 if none found.
 */
export const findFirstPendingApprovalIndex = (
  parts: ExtendedPart[],
): number => {
  const allTools = findAllToolsDeep(parts);
  return allTools.findIndex((part) => part.state === "approval-requested");
};

// ── isToolDisabled ────────────────────────────────────────────────────────────

/**
 * Checks if a specific tool should be disabled based on pending approvals.
 * A tool is disabled if there's a pending approval before it in the flattened order.
 */
export const isToolDisabled = (
  part: ConversationToolPart,
  allPartsFlat: ConversationToolPart[],
  firstPendingIndex: number,
): boolean => {
  if (firstPendingIndex === -1) return false;
  const toolIndex = allPartsFlat.indexOf(part);
  return toolIndex > firstPendingIndex && part.state === "approval-requested";
};

// ── collectApprovalRequests ───────────────────────────────────────────────────

/**
 * Deep-scans merged parts to collect all ACTUALLY-SUSPENDED tool parts
 * (state "approval-requested"), returning one {approvalId, toolCallId} entry
 * per unique suspended call.  Each entry is what the server needs in order to
 * call agent.approveToolCall / agent.declineToolCall.
 *
 * Unlike findPendingApprovals, this does NOT expand take_action into nested
 * cards — it returns the real suspended tool (e.g. agent-take_action itself)
 * so the toolCallId is the one Mastra expects.
 */
export const collectApprovalRequests = (
  parts: ExtendedPart[],
): Array<{ approvalId: string; toolCallId: string }> => {
  const results: Array<{ approvalId: string; toolCallId: string }> = [];
  const seenApprovalIds = new Set<string>();

  const walk = (
    partList: Array<
      ExtendedPart | ConversationToolPart | { type: "text"; text: string }
    >,
  ) => {
    for (const p of partList) {
      const type = (p as { type?: string }).type;
      if (typeof type !== "string" || !type.includes("tool-")) continue;

      const part = p as unknown as ConversationToolPart;

      if (
        part.state === "approval-requested" &&
        part.approval?.id &&
        part.toolCallId
      ) {
        if (!seenApprovalIds.has(part.approval.id)) {
          seenApprovalIds.add(part.approval.id);
          results.push({
            approvalId: part.approval.id,
            toolCallId: part.toolCallId,
          });
        }
        // Don't recurse into approval-requested parts — nested tools are
        // under this approval and will be resumed by a single approveToolCall.
      } else {
        const nested = getNestedPartsFromOutput(part.output);
        if (nested.length > 0) walk(nested);
      }
    }
  };

  walk(parts);
  return results;
};

// ── findPendingApprovals ──────────────────────────────────────────────────────

/**
 * Depth-first walk to collect all parts with state "approval-requested".
 * When a part is approval-requested:
 *   - For take_action: expands into ALL nested tool calls (sharing the parent approval id),
 *     so each tool call shows as its own card.
 *   - Otherwise: adds the part directly.
 * For non-pending tool parts, recurses into getNestedPartsFromOutput(part.output).
 */
export const findPendingApprovals = (
  parts: ExtendedPart[],
): ConversationToolPart[] => {
  const results: ConversationToolPart[] = [];

  const walk = (
    partList: Array<
      ExtendedPart | ConversationToolPart | { type: "text"; text: string }
    >,
  ) => {
    for (const p of partList) {
      const type = (p as { type?: string }).type;
      if (typeof type !== "string" || !type.includes("tool-")) continue;

      // Safe to treat as ConversationToolPart — all tool parts share this shape
      const part = p as unknown as ConversationToolPart;

      if (part.state === "approval-requested") {
        const toolName = part.type.replace("tool-", "");
        // Expand take_action: show only nested tools without results as separate cards
        if (toolName === "take_action" || toolName === "agent-take_action") {
          const nested = getNestedPartsFromOutput(part.output).filter(
            (np): np is ConversationToolPart =>
              np.type.includes("tool-") &&
              np.state !== "output-available" &&
              np.state !== "output-error" &&
              np.state !== "output-denied" &&
              np.state !== "approval-responded",
          );
          if (nested.length > 0) {
            // Each nested card borrows the parent approval id
            nested.forEach((np) =>
              results.push({ ...np, approval: part.approval }),
            );
            continue;
          }
        }
        results.push(part);
      } else {
        const nested = getNestedPartsFromOutput(part.output);
        if (nested.length > 0) walk(nested);
      }
    }
  };

  walk(parts);
  return results;
};

// ── getToolDisplayName ────────────────────────────────────────────────────────

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
    get_integration_actions: "Get integration actions",
    decision: "Decision",
    silent_action: "Silent action",
    "agent-gather_context": "Gather Context",
    "agent-take_action": "Take Action",
    "agent-think": "Think",
  };

  if (displayNameMap[name]) {
    return displayNameMap[name];
  }

  if (name === "execute_integration_action") {
    return name
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  if (name.startsWith("agent-gateway_")) {
    const gatewayName = name.replace("agent-gateway_", "").replace(/_/g, " ");
    return `Gateway: ${gatewayName.charAt(0).toUpperCase() + gatewayName.slice(1)}`;
  }

  if (name.startsWith("gateway_")) {
    const gatewayName = name.replace("gateway_", "").replace(/_/g, " ");
    return `Gateway: ${gatewayName.charAt(0).toUpperCase() + gatewayName.slice(1)}`;
  }

  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// ── mergeAgentParts ───────────────────────────────────────────────────────────

/**
 * Merges data-tool-agent streaming chunks into their parent agent tool parts.
 * Mastra streams subagent activity as separate "data-tool-agent" sibling parts
 * instead of nesting them inside the parent tool's output during streaming.
 */
export const mergeAgentParts = (parts: UIMessagePart[]): ExtendedPart[] => {
  const result: ExtendedPart[] = [];
  let lastAgentTool: AgentToolPart | null = null;

  for (const part of parts) {
    const partType = (part as ExtendedPart & { type?: string }).type;

    if (partType === "data-tool-agent" || partType === "tool-agent") {
      const raw = part as DataToolAgentPart;
      const agentData: Partial<AgentOutput> = raw.data ?? raw;

      if (!lastAgentTool) {
        // Orphan data-tool-agent from a resumed stream (approval continuation)
        // — the original agent-take_action wrapper was in the previous message.
        // Create a synthetic wrapper so the nested tool calls are visible.
        const synthetic: AgentToolPart = {
          type: "tool-agent-take_action",
          toolCallId: (raw.id as string) ?? "resumed",
          state: "output-available" as ToolPartState,
          input: {},
          output: {} as AgentOutput,
        };
        lastAgentTool = synthetic;
        result.push(synthetic);
      }

      if (!isObject(lastAgentTool.output)) {
        lastAgentTool.output = {} as AgentOutput;
      }
      const out = lastAgentTool.output as AgentOutput;

      if (agentData.toolCalls) {
        out.toolCalls = [...(out.toolCalls ?? []), ...agentData.toolCalls];
      }
      if (agentData.toolResults) {
        out.toolResults = [
          ...(out.toolResults ?? []),
          ...agentData.toolResults,
        ];
      }
      if (agentData.steps) {
        out.steps = agentData.steps;
      }
      if (agentData.text) {
        out.text = agentData.text;
      }
      if (agentData.subAgentToolResults) {
        out.subAgentToolResults = agentData.subAgentToolResults;
      }
      // Don't add data-tool-agent to result — it's merged into parent
      continue;
    }

    const toolName =
      typeof partType === "string" ? partType.replace("tool-", "") : "";

    if (toolName.startsWith("agent-")) {
      // Clone to avoid mutating the original message part
      const cloned = { ...(part as unknown as AgentToolPart) };
      if (!isObject(cloned.output)) {
        cloned.output = {} as AgentOutput;
      }
      lastAgentTool = cloned;
      result.push(cloned);
    } else {
      result.push(part as ExtendedPart);
      // Reset tracker for non-agent tools
      if (typeof partType === "string" && partType.includes("tool-")) {
        lastAgentTool = null;
      }
    }
  }

  return result;
};

// ── groupToolParts ────────────────────────────────────────────────────────────

/**
 * Groups consecutive tool parts together for collapsible rendering.
 */
export const groupToolParts = (parts: ExtendedPart[]): GroupedPart[] => {
  const grouped: GroupedPart[] = [];
  let currentToolGroup: ExtendedPart[] = [];

  for (const part of parts) {
    const partType = (part as { type?: string }).type;
    if (typeof partType === "string" && partType.includes("tool-")) {
      currentToolGroup.push(part);
    } else {
      if (currentToolGroup.length > 0) {
        grouped.push({ type: "tool-group", parts: [...currentToolGroup] });
        currentToolGroup = [];
      }
      grouped.push({ type: "single", parts: [part] });
    }
  }

  if (currentToolGroup.length > 0) {
    grouped.push({ type: "tool-group", parts: [...currentToolGroup] });
  }

  return grouped;
};

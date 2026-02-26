/**
 * CIM Multi-Agent Orchestration
 *
 * Coordinates multiple specialized agents working together.
 * Each agent has a specific role, its own Soul config, and
 * operates independently within its permission boundaries.
 *
 * Architecture:
 *   - Agent Registry: Register and manage agent definitions
 *   - Agent Teams: Group agents with a coordinator
 *   - Context Bundles: Full context packed into every sub-agent spawn
 *   - Message Passing: Agents communicate via structured messages
 *   - Handoffs: Agents can escalate or delegate to others
 *
 * Based on the Mission Control pattern for agent swarms.
 */

import { logger } from "~/services/logger.service";

import type {
  AgentDefinition,
  AgentRole,
  AgentTeam,
  AgentMessage,
  ContextBundle,
  SoulConfig,
  PermissionPolicy,
  ModelTier,
  ExternalMemoryEntry,
} from "./types";
import { createDefaultSoulConfig } from "./memory-manager";

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

const agentRegistry = new Map<string, AgentDefinition>();

export function registerAgent(definition: AgentDefinition): void {
  agentRegistry.set(definition.id, definition);
  logger.info(
    `[CIM:MultiAgent] Registered agent: ${definition.name} (${definition.role})`,
  );
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  return agentRegistry.get(agentId);
}

export function listAgents(role?: AgentRole): AgentDefinition[] {
  const agents = Array.from(agentRegistry.values());
  return role ? agents.filter((a) => a.role === role) : agents;
}

export function removeAgent(agentId: string): boolean {
  const removed = agentRegistry.delete(agentId);
  if (removed) {
    logger.info(`[CIM:MultiAgent] Removed agent: ${agentId}`);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Pre-built Agent Templates
// ---------------------------------------------------------------------------

export function createAgentDefinition(
  role: AgentRole,
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  const templates: Record<AgentRole, Partial<AgentDefinition>> = {
    orchestrator: {
      name: "Orchestrator",
      description:
        "Coordinates other agents, routes tasks, and manages the overall workflow.",
      modelTier: "high",
      tools: [
        "memory_search",
        "integration_query",
        "integration_action",
        "web_search",
      ],
    },
    researcher: {
      name: "Researcher",
      description:
        "Gathers information from memory, integrations, and the web. Read-only.",
      modelTier: "low",
      tools: ["memory_search", "integration_query", "web_search"],
    },
    writer: {
      name: "Content Writer",
      description:
        "Drafts content based on context. Adapts to user's voice and preferences.",
      modelTier: "high",
      tools: ["memory_search", "web_search"],
    },
    executor: {
      name: "Action Executor",
      description:
        "Takes actions on integrations. Creates, updates, and sends things.",
      modelTier: "high",
      tools: ["integration_action"],
    },
    monitor: {
      name: "Monitor",
      description:
        "Runs periodic checks on integrations and flags items needing attention.",
      modelTier: "low",
      tools: ["integration_query"],
    },
    analyst: {
      name: "Analyst",
      description:
        "Analyzes data from integrations and memory to provide insights and reports.",
      modelTier: "high",
      tools: ["memory_search", "integration_query", "web_search"],
    },
    custom: {
      name: "Custom Agent",
      description: "A custom agent with user-defined capabilities.",
      modelTier: "high",
      tools: [],
    },
  };

  const template = templates[role];
  const baseSoul = createDefaultSoulConfig();

  const definition: AgentDefinition = {
    id: overrides.id || `agent-${role}-${Date.now()}`,
    role,
    name: overrides.name || template.name || role,
    description: overrides.description || template.description || "",
    soulConfig: overrides.soulConfig || {
      ...baseSoul,
      identity: {
        ...baseSoul.identity,
        name: overrides.name || template.name || role,
        role: role,
        description: overrides.description || template.description || "",
      },
    },
    permissions: overrides.permissions || [],
    modelTier: overrides.modelTier || template.modelTier || "high",
    tools: overrides.tools || template.tools || [],
  };

  return definition;
}

// ---------------------------------------------------------------------------
// Agent Teams
// ---------------------------------------------------------------------------

const teamRegistry = new Map<string, AgentTeam>();

export function createTeam(
  name: string,
  agentRoles: AgentRole[],
  coordinatorRole: AgentRole = "orchestrator",
): AgentTeam {
  const agents = agentRoles.map((role) => {
    const agent = createAgentDefinition(role);
    registerAgent(agent);
    return agent;
  });

  // Ensure coordinator exists
  let coordinator = agents.find((a) => a.role === coordinatorRole);
  if (!coordinator) {
    coordinator = createAgentDefinition(coordinatorRole);
    registerAgent(coordinator);
    agents.unshift(coordinator);
  }

  const team: AgentTeam = {
    id: `team-${Date.now()}`,
    name,
    agents,
    coordinatorId: coordinator.id,
    sharedContext: {},
  };

  teamRegistry.set(team.id, team);

  logger.info(
    `[CIM:MultiAgent] Created team "${name}" with ${agents.length} agents. ` +
      `Coordinator: ${coordinator.name}`,
  );

  return team;
}

export function getTeam(teamId: string): AgentTeam | undefined {
  return teamRegistry.get(teamId);
}

// ---------------------------------------------------------------------------
// Context Bundle Protocol
// ---------------------------------------------------------------------------

export function createContextBundle(
  userId: string,
  workspaceId: string,
  goal: string,
  options: {
    userContext?: string;
    constraints?: string[];
    sharedMemory?: ExternalMemoryEntry[];
    parentAgentId?: string;
    verificationRequired?: boolean;
  } = {},
): ContextBundle {
  return {
    userId,
    workspaceId,
    userContext: options.userContext || "",
    currentGoal: goal,
    constraints: options.constraints || [
      "Verify your work before reporting back",
      "Stay within your assigned scope",
      "Report blockers immediately",
    ],
    sharedMemory: options.sharedMemory || [],
    parentAgentId: options.parentAgentId,
    verificationRequired: options.verificationRequired ?? true,
  };
}

export function bundleToPrompt(bundle: ContextBundle): string {
  const sections: string[] = [
    `## Context`,
    `User ID: ${bundle.userId}`,
    `Workspace: ${bundle.workspaceId}`,
  ];

  if (bundle.userContext) {
    sections.push(`\n## User Context\n${bundle.userContext}`);
  }

  sections.push(`\n## Current Goal\n${bundle.currentGoal}`);

  if (bundle.constraints.length > 0) {
    sections.push(
      `\n## Constraints\n${bundle.constraints.map((c) => `- ${c}`).join("\n")}`,
    );
  }

  if (bundle.sharedMemory.length > 0) {
    const memoryText = bundle.sharedMemory
      .map((m) => `- [${m.type}] ${m.content}`)
      .join("\n");
    sections.push(`\n## Shared Memory\n${memoryText}`);
  }

  if (bundle.verificationRequired) {
    sections.push(
      `\n## Verification Required\nYou MUST verify your results before reporting back. Double-check facts and confirm actions completed successfully.`,
    );
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Message Passing
// ---------------------------------------------------------------------------

const messageQueue: AgentMessage[] = [];

export function sendMessage(message: AgentMessage): void {
  messageQueue.push(message);
  logger.info(
    `[CIM:MultiAgent] Message from ${message.fromAgentId} to ${message.toAgentId}: ${message.type}`,
  );
}

export function getMessages(
  agentId: string,
  type?: AgentMessage["type"],
): AgentMessage[] {
  return messageQueue.filter(
    (m) => m.toAgentId === agentId && (!type || m.type === type),
  );
}

export function createHandoff(
  fromAgentId: string,
  toAgentId: string,
  task: string,
  context: Record<string, unknown> = {},
): AgentMessage {
  const message: AgentMessage = {
    fromAgentId,
    toAgentId,
    type: "handoff",
    payload: { task, context },
    timestamp: new Date(),
  };

  sendMessage(message);
  return message;
}

export function createEscalation(
  fromAgentId: string,
  reason: string,
  context: Record<string, unknown> = {},
): AgentMessage {
  // Escalations go to the coordinator or to a human
  const message: AgentMessage = {
    fromAgentId,
    toAgentId: "human",
    type: "escalation",
    payload: { reason, context },
    timestamp: new Date(),
  };

  sendMessage(message);
  logger.warn(
    `[CIM:MultiAgent] Escalation from ${fromAgentId}: ${reason}`,
  );
  return message;
}

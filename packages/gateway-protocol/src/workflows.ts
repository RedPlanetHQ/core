import { z } from "zod";

export const PHASE_ADVANCE_ON = ["user-approval", "done"] as const;

export const WorkflowPhase = z.object({
  /** Stable identifier within the track (e.g. "brainstorm", "plan", "execute"). */
  name: z.string().min(1),
  /** Templated prompt. Variables: {title}, {description}, {answers}, {previousPhaseOutput}, {worktreePath}, {sessionId}. */
  prompt: z.string().min(1),
  /** Seconds between coding_read_session polls during this phase. */
  pollSeconds: z.number().int().positive(),
  /** "user-approval" — return to user; "done" — terminal. */
  advanceOn: z.enum(PHASE_ADVANCE_ON),
});
export type WorkflowPhase = z.infer<typeof WorkflowPhase>;

export const WorkflowTrack = z.object({
  phases: z.array(WorkflowPhase).min(1),
});
export type WorkflowTrack = z.infer<typeof WorkflowTrack>;

export const AgentWorkflows = z.object({
  bug: WorkflowTrack,
  feature: WorkflowTrack,
  /** Phase names (formatted "<track>.<phaseName>") whose prompt references a missing plugin slash command or skill path. */
  unresolved: z.array(z.string()).default([]),
});
export type AgentWorkflows = z.infer<typeof AgentWorkflows>;

export const WorkflowsBlock = z.object({
  /** "config" when user overrides, "preset:<name>" when a preset was matched, "preset:raw" for fallback. */
  source: z.string(),
  /** Resolved workflows keyed by agent name (e.g. "claude-code"). */
  perAgent: z.record(z.string(), AgentWorkflows),
});
export type WorkflowsBlock = z.infer<typeof WorkflowsBlock>;

export const PluginSkill = z.object({
  agent: z.string(),    // e.g. "claude-code"
  plugin: z.string(),   // e.g. "superpowers"
  skill: z.string(),    // e.g. "systematic-debugging"
  command: z.string(),  // e.g. "/superpowers:systematic-debugging" or "/brainstorming"
});
export type PluginSkill = z.infer<typeof PluginSkill>;

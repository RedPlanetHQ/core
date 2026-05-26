import type {
  WorkflowsBlock,
  WorkflowTrack,
  WorkflowPhase,
} from "@redplanethq/gateway-protocol";

export type TrackName = "bug" | "feature";

export interface PromptVars {
  title: string;
  description: string;
  answers?: string;
  previousPhaseOutput?: string;
  worktreePath?: string;
  sessionId?: string;
}

export function pickTrack(
  workflows: WorkflowsBlock | undefined,
  agent: string,
  track: TrackName,
): WorkflowTrack | undefined {
  return workflows?.perAgent?.[agent]?.[track];
}

export function pickPhase(
  workflows: WorkflowsBlock | undefined,
  agent: string,
  track: TrackName,
  index: number,
): WorkflowPhase | undefined {
  return pickTrack(workflows, agent, track)?.phases[index];
}

const KNOWN_KEYS = new Set([
  "title",
  "description",
  "answers",
  "previousPhaseOutput",
  "worktreePath",
  "sessionId",
]);

function escapeDescription(value: string): string {
  if (!value) return "";
  const escaped = value.replace(/^```/gm, "\\`\\`\\`");
  return "```\n" + escaped + "\n```";
}

function interpolate(prompt: string, vars: PromptVars): string {
  return prompt.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (!KNOWN_KEYS.has(key)) return "";
    if (key === "description") return escapeDescription(vars.description ?? "");
    const v = (vars as Record<string, string | undefined>)[key];
    return v == null ? "" : v;
  });
}

export function buildPrompt(
  workflows: WorkflowsBlock | undefined,
  agent: string,
  track: TrackName,
  index: number,
  vars: PromptVars,
): string | undefined {
  const phase = pickPhase(workflows, agent, track, index);
  if (!phase) return undefined;
  return interpolate(phase.prompt, vars);
}

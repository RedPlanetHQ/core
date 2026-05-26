import type {
  GatewaySkill,
  PluginSkill,
  WorkflowsBlock,
  WorkflowTrack,
  AgentWorkflows,
} from '@redplanethq/gateway-protocol';
import { WorkflowsBlock as WorkflowsBlockSchema } from '@redplanethq/gateway-protocol';
import type {
  UserPreferences,
  AgentCodingWorkflows,
  CodingWorkflowTrack,
} from '@/types/config';
import { loadPresets, type PresetFile } from './presets-loader';
import { lintTrack } from './lint';

export interface ResolverInput {
  prefs: Partial<UserPreferences>;
  /** Coding agents the gateway exposes (keys of prefs.coding). */
  agentsConfigured: string[];
  pluginSkills: PluginSkill[];
  skills: GatewaySkill[];
  superpowersPresent: boolean;
}

function presetTrack(
  preset: PresetFile | undefined,
  trackName: 'bug' | 'feature',
): WorkflowTrack | undefined {
  if (!preset) return undefined;
  const raw = preset.tracks[trackName];
  if (!raw) return undefined;
  return raw as unknown as WorkflowTrack;
}

function configTrack(
  agentCfg: AgentCodingWorkflows | undefined,
  trackName: 'bug' | 'feature',
): WorkflowTrack | undefined {
  const t = agentCfg?.[trackName] as CodingWorkflowTrack | undefined;
  if (!t || !t.phases || t.phases.length === 0) return undefined;
  return t as unknown as WorkflowTrack;
}

function pickPreset(
  presets: PresetFile[],
  agent: string,
  superpowersPresent: boolean,
): PresetFile | undefined {
  if (superpowersPresent) {
    const sp = presets.find((p) => p.name === 'superpowers');
    if (sp && sp.appliesTo.includes(agent)) return sp;
  }
  return undefined;
}

export function resolveWorkflows(input: ResolverInput): WorkflowsBlock {
  const { prefs, agentsConfigured, pluginSkills, skills, superpowersPresent } =
    input;
  const presets = loadPresets();
  const raw = presets.find((p) => p.name === 'raw');
  if (!raw) {
    throw new Error('workflows: missing required preset "raw"');
  }

  const cfg = prefs.codingWorkflows ?? {};

  let anyConfigUsed = false;
  let anyDetectedPresetUsed = false;
  const perAgent: Record<string, AgentWorkflows> = {};

  for (const agent of agentsConfigured) {
    const agentCfg = cfg[agent];
    const detected = pickPreset(presets, agent, superpowersPresent);
    const rawForAgent = raw.appliesTo.includes(agent) ? raw : raw;

    const bug =
      configTrack(agentCfg, 'bug') ??
      presetTrack(detected, 'bug') ??
      presetTrack(rawForAgent, 'bug')!;
    const feature =
      configTrack(agentCfg, 'feature') ??
      presetTrack(detected, 'feature') ??
      presetTrack(rawForAgent, 'feature')!;

    if (configTrack(agentCfg, 'bug') || configTrack(agentCfg, 'feature'))
      anyConfigUsed = true;
    if (detected) anyDetectedPresetUsed = true;

    const unresolved = [
      ...lintTrack('bug', bug, agent, pluginSkills, skills),
      ...lintTrack('feature', feature, agent, pluginSkills, skills),
    ];

    perAgent[agent] = { bug, feature, unresolved };
  }

  let source: string;
  if (anyConfigUsed) source = 'config';
  else if (anyDetectedPresetUsed) source = 'preset:superpowers';
  else source = 'preset:raw';

  const block: WorkflowsBlock = { source, perAgent };
  return WorkflowsBlockSchema.parse(block);
}

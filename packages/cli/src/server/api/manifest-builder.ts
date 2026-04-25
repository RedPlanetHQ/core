import {hostname, platform} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {
	PROTOCOL_VERSION,
	type Manifest,
	type AvailableAgent,
	type DeployMode,
} from '@redplanethq/gateway-protocol';
import type {GatewayConfig, GatewaySlots} from '@/types/config';
import {getPreferences} from '@/config/preferences';
import {listFolders} from '@/config/folders';
import {browserTools} from '@/server/tools/browser-tools';
import {codingTools} from '@/server/tools/coding-tools';
import {execTools} from '@/server/tools/exec-tools';
import {filesTools} from '@/server/tools/files-tools';
import {utilsTools} from '@/server/tools/utils-tools';

let cliVersion = '0.0.0';
try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	cliVersion = require('../../../package.json').version ?? cliVersion;
} catch {
	/* compiled build may not have the package.json alongside */
}

/**
 * Project an internal tool export (may have extra metadata) onto the public
 * GatewayTool shape the manifest advertises.
 */
function projectTool(t: {
	name: string;
	description: string;
	inputSchema?: unknown;
}) {
	return {
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema as Record<string, unknown> | undefined,
	};
}

// Coding agents the gateway knows how to drive. Each entry maps the public
// agent name (used in the manifest + tool params) to the binary we'll run on
// PATH. Add new entries here when a new agent is supported.
const KNOWN_AGENTS: Array<{name: string; command: string}> = [
	{name: 'claude-code', command: 'claude'},
	{name: 'codex-cli', command: 'codex'},
];

/**
 * Resolve a bare command via the env's PATH (the same one node-pty will use
 * when spawning). Returns the absolute path on success, null otherwise.
 *
 * We don't capture login PATH here because the manifest endpoint is hit very
 * frequently; reading PATH from the process env is sufficient — the gateway
 * is started by `corebrain gateway start` which already inherits the user's
 * shell PATH (foreground mode) or had it captured at PtyManager load.
 */
function resolveBinary(cmd: string): string | null {
	if (cmd.includes('/')) return existsSync(cmd) ? cmd : null;
	try {
		const out = execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], {
			encoding: 'utf8',
			timeout: 2_000,
		});
		const path = out.trim();
		return path || null;
	} catch {
		return null;
	}
}

function detectAvailableAgents(
	configuredAgents: Set<string>,
	coding: Record<string, {command?: string} | undefined>,
): AvailableAgent[] {
	const result: AvailableAgent[] = [];
	for (const agent of KNOWN_AGENTS) {
		// Prefer the user-configured command (often an absolute path written
		// during `corebrain coding setup`). Falls back to a PATH lookup of the
		// bare binary, which is unreliable for daemons launched by launchd /
		// systemd because they don't inherit the login shell's PATH.
		const configuredCommand = coding[agent.name]?.command;
		const path =
			(configuredCommand ? resolveBinary(configuredCommand) : null) ??
			resolveBinary(agent.command);
		if (!path) continue;
		result.push({
			name: agent.name,
			command: agent.command,
			path,
			configured: configuredAgents.has(agent.name),
		});
	}
	return result;
}

function detectDeployMode(): DeployMode {
	// Explicit env wins (Dockerfile sets COREBRAIN_DEPLOY_MODE=docker).
	const envMode = process.env.COREBRAIN_DEPLOY_MODE;
	if (envMode === 'docker' || envMode === 'native') return envMode;
	// Fallback heuristic — `/.dockerenv` is created by Docker on container init.
	if (existsSync('/.dockerenv')) return 'docker';
	return 'native';
}

/**
 * Env override for slot enablement. `COREBRAIN_SLOT_<NAME>` (e.g.
 * `COREBRAIN_SLOT_FILES=false`) wins over the on-disk slot config so docker
 * deploys can default a slot off via `ENV` without rewriting preferences,
 * and operators can flip a slot at runtime by restarting with a different
 * env value. Recognises `true|1|yes` and `false|0|no` (case-insensitive);
 * any other value is ignored and falls through to the on-disk setting.
 */
function envSlotOverride(slot: keyof GatewaySlots): boolean | undefined {
	const raw = process.env[`COREBRAIN_SLOT_${slot.toUpperCase()}`];
	if (raw === undefined || raw === '') return undefined;
	const v = raw.trim().toLowerCase();
	if (v === 'true' || v === '1' || v === 'yes') return true;
	if (v === 'false' || v === '0' || v === 'no') return false;
	return undefined;
}

/**
 * A slot is considered enabled unless the user explicitly disabled it via
 * `corebrain gateway config` (slots[name].enabled === false) or via the
 * `COREBRAIN_SLOT_<NAME>` env var. Missing config means enabled, for
 * backwards compatibility.
 */
export function isSlotEnabled(
	slots: GatewaySlots | undefined,
	slot: keyof GatewaySlots,
): boolean {
	const override = envSlotOverride(slot);
	if (override !== undefined) return override;
	if (!slots) return true;
	const entry = slots[slot];
	if (!entry) return true;
	return (entry as {enabled?: boolean}).enabled !== false;
}

export function buildManifest(): {manifest: Manifest; etag: string} {
	const prefs = getPreferences();
	const gw: Partial<GatewayConfig> = prefs.gateway ?? {};
	const slots = gw.slots;

	// Respect the user's slot toggles — a disabled slot hides its tools (and
	// agents, when coding is off) from the manifest. Callers that shouldn't
	// see a tool shouldn't be able to hit its route either; server.ts applies
	// the same filter when registering routes.
	const tools = [
		...(isSlotEnabled(slots, 'browser') ? browserTools : []),
		...(isSlotEnabled(slots, 'coding') ? codingTools : []),
		...(isSlotEnabled(slots, 'exec') ? execTools : []),
		...(isSlotEnabled(slots, 'files') ? filesTools : []),
		...utilsTools,
	].map(projectTool);

	// Configured coding agents — keys of prefs.coding (e.g. "claude-code", "codex-cli").
	// Empty when the coding slot is disabled so UIs don't offer agents the user
	// doesn't want exposed.
	const coding = (prefs.coding ?? {}) as Record<string, unknown>;
	const agents = isSlotEnabled(slots, 'coding') ? Object.keys(coding) : [];

	const configuredAgents = new Set(agents);
	const availableAgents = isSlotEnabled(slots, 'coding')
		? detectAvailableAgents(
				configuredAgents,
				coding as Record<string, {command?: string} | undefined>,
		  )
		: [];

	const manifest: Manifest = {
		protocolVersion: PROTOCOL_VERSION,
		gateway: {
			id: gw.id ?? 'pending',
			name: gw.name ?? `${hostname()}-gateway`,
			version: cliVersion,
			platform: platform(),
			hostname: hostname(),
			deployMode: detectDeployMode(),
		},
		capabilities: {
			browser: {
				enabled: isSlotEnabled(slots, 'browser'),
				engines: ['chromium'],
			},
		},
		folders: listFolders(),
		tools,
		agents,
		availableAgents,
	};
	const etag = createHash('sha256')
		.update(JSON.stringify(manifest))
		.digest('hex')
		.slice(0, 16);
	return {manifest, etag};
}

import {hostname, platform} from 'node:os';
import {createHash} from 'node:crypto';
import {PROTOCOL_VERSION, type Manifest} from '@core/gateway-protocol';
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
function projectTool(t: {name: string; description: string; inputSchema?: unknown}) {
	return {
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema as Record<string, unknown> | undefined,
	};
}

/**
 * A slot is considered enabled unless the user explicitly disabled it via
 * `corebrain gateway config` (slots[name].enabled === false). Missing config
 * means enabled, for backwards compatibility.
 */
export function isSlotEnabled(
	slots: GatewaySlots | undefined,
	slot: keyof GatewaySlots,
): boolean {
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

	const manifest: Manifest = {
		protocolVersion: PROTOCOL_VERSION,
		gateway: {
			id: gw.id ?? 'pending',
			name: gw.name ?? `${hostname()}-gateway`,
			version: cliVersion,
			platform: platform(),
			hostname: hostname(),
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
	};
	const etag = createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
	return {manifest, etag};
}

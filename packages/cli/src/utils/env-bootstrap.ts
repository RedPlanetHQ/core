import {randomUUID} from 'node:crypto';
import {existsSync, realpathSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {updateConfig, getConfig} from '@/config/index';
import {getPreferences, updatePreferences} from '@/config/preferences';
import type {
	CliBackendConfig,
	CodingConfig,
	GatewaySlots,
	StoredFolder,
} from '@/types/config';
import {generateSecurityKey, hashKey} from '@/server/api/auth';
import {AGENT_TEMPLATES, resolveCommand} from '@/utils/agent-templates';

/**
 * Bootstrap a gateway config from environment variables when running
 * headless (Docker / systemd without an interactive `corebrain login` +
 * `corebrain gateway config` flow).
 *
 * Reads (all optional; only missing values are filled in):
 *
 *   COREBRAIN_API_URL              → core.auth.url
 *   COREBRAIN_API_KEY              → core.auth.apiKey (user's PAT)
 *   COREBRAIN_GATEWAY_NAME         → preferences.gateway.name
 *   COREBRAIN_GATEWAY_DESCRIPTION  → preferences.gateway.description
 *   COREBRAIN_GATEWAY_SECURITY_KEY → if set, used as the gateway's auth key.
 *                                    Otherwise one is generated and printed
 *                                    to stdout *once* for the user to paste
 *                                    into the webapp's Register Gateway flow.
 *   COREBRAIN_DEFAULT_WORKSPACE    → auto-registered as a folder with
 *                                    [files, coding, exec] scopes; also flips
 *                                    on browser/coding/files/exec slots so a
 *                                    fresh container is ready to use.
 *
 * Idempotent. Safe to call on every gateway boot. Never overwrites a value
 * already present in the on-disk config — so a user who manually runs
 * `corebrain login` / `corebrain gateway config` inside their container
 * won't have their hand-entered values clobbered on restart.
 *
 * Returns the set of fields that were populated, for logging.
 */
export function bootstrapFromEnv(): string[] {
	const applied: string[] = [];

	const apiUrl = process.env.COREBRAIN_API_URL;
	const apiKey = process.env.COREBRAIN_API_KEY;
	const gwName = process.env.COREBRAIN_GATEWAY_NAME;
	const gwDesc = process.env.COREBRAIN_GATEWAY_DESCRIPTION;
	const defaultWorkspace = process.env.COREBRAIN_DEFAULT_WORKSPACE;

	// --- core.auth ---
	// auth requires both url and apiKey, so we only persist when the merge
	// would yield a complete pair (env-supplied or already on disk).
	const config = getConfig();
	const mergedUrl = config.auth?.url ?? apiUrl;
	const mergedApiKey = config.auth?.apiKey ?? apiKey;
	const addedUrl = !config.auth?.url && !!apiUrl;
	const addedApiKey = !config.auth?.apiKey && !!apiKey;
	if ((addedUrl || addedApiKey) && mergedUrl && mergedApiKey) {
		updateConfig({auth: {url: mergedUrl, apiKey: mergedApiKey}});
		if (addedUrl) applied.push('COREBRAIN_API_URL');
		if (addedApiKey) applied.push('COREBRAIN_API_KEY');
	}

	// --- preferences.gateway ---
	const prefs = getPreferences();
	const existing = prefs.gateway ?? {pid: 0, startedAt: 0};

	// Local id — internal key for the gateway record. Webapp assigns its own
	// ID at registration time; this is just to satisfy the existing
	// "configured" check in the start command.
	const needsId = !existing.id;
	const namePatch = gwName && !existing.name ? {name: gwName} : {};
	const descPatch =
		gwDesc && !existing.description ? {description: gwDesc} : {};

	// Security key. Without this every authed request returns 401, so make
	// sure a fresh container always boots with one. Three cases:
	//   1) Env var supplied → use it (user controls the value via Railway/Fly env).
	//   2) Already on disk    → keep it.
	//   3) Neither            → generate, persist the hash, print the raw key
	//                           so the user can paste it into the webapp's
	//                           "Register gateway" dialog.
	const envKey = process.env.COREBRAIN_GATEWAY_SECURITY_KEY;
	let securityKeyPatch: {securityKeyHash?: string} = {};
	let printRawKey: string | null = null;
	if (envKey && !existing.securityKeyHash) {
		securityKeyPatch.securityKeyHash = hashKey(envKey);
		applied.push('COREBRAIN_GATEWAY_SECURITY_KEY');
	} else if (!envKey && !existing.securityKeyHash) {
		printRawKey = generateSecurityKey();
		securityKeyPatch.securityKeyHash = hashKey(printRawKey);
		applied.push('generated-security-key');
	}

	// Default slots: browser/coding/files/exec on. Only applied to a fresh
	// gateway record — once a slot has any explicit setting (even `false`),
	// we don't override it.
	const slotsPatch: {slots?: GatewaySlots} = {};
	if (!existing.slots) {
		slotsPatch.slots = {
			browser: {enabled: true},
			coding: {enabled: true},
			files: {enabled: true},
			exec: {enabled: true},
		};
	}

	// Auto-register /app (or whatever COREBRAIN_DEFAULT_WORKSPACE points at)
	// as a coding+files+exec folder so a brand-new container is immediately
	// usable from the webapp's "New coding session" dialog without the user
	// having to add a folder manually.
	const foldersPatch: {folders?: StoredFolder[]} = {};
	if (defaultWorkspace && existsSync(defaultWorkspace)) {
		try {
			const abs = realpathSync(resolve(defaultWorkspace));
			if (statSync(abs).isDirectory()) {
				const existingFolders = existing.folders ?? [];
				if (!existingFolders.some(f => f.path === abs)) {
					const baseName = abs.split('/').filter(Boolean).pop() ?? 'app';
					let name = baseName;
					for (let i = 2; existingFolders.some(f => f.name === name); i++) {
						name = `${baseName}-${i}`;
					}
					foldersPatch.folders = [
						...existingFolders,
						{
							id: `fld_${randomUUID()}`,
							name,
							path: abs,
							scopes: ['files', 'coding', 'exec'],
							gitRepo: existsSync(`${abs}/.git`),
						},
					];
					applied.push(`folder:${name}=${abs}`);
				}
			}
		} catch {
			/* path errors fall through to "no auto-register" */
		}
	}

	if (
		needsId ||
		Object.keys(namePatch).length > 0 ||
		Object.keys(descPatch).length > 0 ||
		slotsPatch.slots ||
		foldersPatch.folders ||
		securityKeyPatch.securityKeyHash
	) {
		updatePreferences({
			gateway: {
				...existing,
				...(needsId ? {id: randomUUID()} : {}),
				...namePatch,
				...descPatch,
				...slotsPatch,
				...foldersPatch,
				...securityKeyPatch,
			},
		});
		if (namePatch.name) applied.push('COREBRAIN_GATEWAY_NAME');
		if (descPatch.description) applied.push('COREBRAIN_GATEWAY_DESCRIPTION');
		if (slotsPatch.slots) applied.push('default-slots');
	}

	// --- preferences.coding ---
	// Auto-configure any coding agent we detect on PATH that isn't already
	// in the user's preferences. This is what `corebrain coding setup` does
	// interactively; doing it on every boot makes Docker / headless installs
	// usable without an extra setup step. Existing entries are never
	// overwritten, so a user who tuned args manually keeps their values.
	const existingCoding = (prefs.coding ?? {}) as CodingConfig;
	const codingPatch: Record<string, CliBackendConfig> = {};
	for (const tmpl of AGENT_TEMPLATES) {
		if (existingCoding[tmpl.name]) continue;
		const cmdPath = tmpl.commands
			.map(c => resolveCommand(c))
			.find((p): p is string => Boolean(p));
		if (!cmdPath) continue;
		codingPatch[tmpl.name] = {
			command: cmdPath,
			...tmpl.defaultConfig,
		};
		applied.push(`coding:${tmpl.name}`);
	}
	if (Object.keys(codingPatch).length > 0) {
		updatePreferences({
			coding: {...existingCoding, ...codingPatch},
		});
	}

	if (printRawKey) {
		// Banner prints to stdout (not the log file) so it's visible in
		// `docker logs <container>` immediately. Shown only once because the
		// next boot already has a hash on disk and skips this branch.
		const banner = [
			'',
			'='.repeat(64),
			'CoreBrain Gateway — security key generated',
			'',
			`  ${printRawKey}`,
			'',
			'Paste this (with your gateway URL) into the webapp:',
			'  Settings → Gateways → New gateway',
			'',
			'Set COREBRAIN_GATEWAY_SECURITY_KEY env var to provide your own.',
			'='.repeat(64),
			'',
		].join('\n');
		process.stdout.write(banner);
	}

	return applied;
}

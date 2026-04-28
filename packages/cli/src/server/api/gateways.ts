import {CoreClient} from '@redplanethq/sdk';
import {getConfig} from '@/config/index';

const DEFAULT_BASE_URL = 'https://app.getcore.me';

/**
 * Local mirror of the SDK's GatewayAgentInfo. We don't import the SDK's
 * `z.infer<...>` types directly because the SDK ships zod@3 schemas while the
 * CLI builds against zod@4 — the inferred types resolve as all-optional on
 * the CLI side. Mirror keeps the contract loud and explicit here.
 */
export interface GatewayInfo {
	id: string;
	name: string;
	description: string;
	baseUrl: string;
	tools: string[];
	platform: string | null;
	hostname: string | null;
	status: 'CONNECTED' | 'DISCONNECTED';
}

interface ManifestResponse {
	gateway?: {
		name?: string;
		hostname?: string;
		platform?: string;
		deployMode?: string;
	};
	tools?: unknown[];
	agents?: unknown[];
}

function getClient(): CoreClient {
	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	if (!apiKey) {
		throw new Error('Not authenticated. Run `corebrain login` first.');
	}
	return new CoreClient({
		baseUrl: config.auth?.url || DEFAULT_BASE_URL,
		token: apiKey,
	});
}

export async function listGateways(): Promise<GatewayInfo[]> {
	const res = await getClient().getGateways();
	return (res.gateways ?? []) as GatewayInfo[];
}

export async function getGatewayById(id: string): Promise<GatewayInfo | null> {
	const gateways = await listGateways();
	return gateways.find(g => g.id === id) ?? null;
}

export interface RegisterArgs {
	baseUrl: string;
	securityKey: string;
	name?: string;
	description?: string;
}

export async function registerGatewayWithApi(
	args: RegisterArgs,
): Promise<{gatewayId: string}> {
	const res = await getClient().registerGateway(args);
	if (!res.gatewayId) {
		throw new Error('Webapp returned no gatewayId. Check the gateway is reachable.');
	}
	return {gatewayId: res.gatewayId};
}

/**
 * Live-fetch a gateway's manifest using its raw security key. Returns null
 * on any failure (not reachable, key mismatch, malformed response).
 */
export async function fetchManifest(
	baseUrl: string,
	securityKey: string,
): Promise<ManifestResponse | null> {
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/manifest`, {
			headers: {authorization: `Bearer ${securityKey}`},
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return null;
		return (await res.json()) as ManifestResponse;
	} catch {
		return null;
	}
}

/**
 * Poll the manifest endpoint until it returns a 200 or we time out.
 * Used after `docker compose up -d` / `railway deploy` to confirm the
 * gateway has booted before we register it.
 */
export async function waitForManifest(
	baseUrl: string,
	securityKey: string,
	timeoutMs = 90_000,
	intervalMs = 2_000,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const m = await fetchManifest(baseUrl, securityKey);
		if (m) return true;
		await new Promise(r => setTimeout(r, intervalMs));
	}
	return false;
}

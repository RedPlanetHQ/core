/**
 * Templates for `corebrain gateway setup --kind docker`.
 *
 * Single source of truth: hosting/gateway/{docker-compose.yaml,.env.example}
 * on the `main` branch of github.com/RedPlanetHQ/core. Fetched at runtime so
 * a CLI release doesn't need to ship a new copy when we tweak them.
 *
 * Per-install config (api key, security key, gateway name) is applied as a
 * small overlay on top of the fetched .env.example via applyEnvOverrides.
 */

const COMPOSE_URL =
	'https://raw.githubusercontent.com/RedPlanetHQ/core/main/hosting/gateway/docker-compose.yaml';

const ENV_EXAMPLE_URL =
	'https://raw.githubusercontent.com/RedPlanetHQ/core/main/hosting/gateway/.env.example';

async function fetchText(url: string, label: string): Promise<string> {
	let res: Response;
	try {
		res = await fetch(url, {signal: AbortSignal.timeout(15_000)});
	} catch (err) {
		throw new Error(
			`Could not fetch ${label} from GitHub. Check your network and try again. ` +
				`(${err instanceof Error ? err.message : String(err)})`,
		);
	}
	if (!res.ok) {
		throw new Error(
			`GitHub returned ${res.status} ${res.statusText} for ${url}. Try again in a moment.`,
		);
	}
	return await res.text();
}

export async function fetchGatewayComposeYaml(): Promise<string> {
	return fetchText(COMPOSE_URL, 'gateway docker-compose.yaml');
}

export async function fetchGatewayEnvExample(): Promise<string> {
	return fetchText(ENV_EXAMPLE_URL, 'gateway .env.example');
}

export const RAILWAY_TEMPLATE_CODE = 'core-gateway';

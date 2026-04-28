/**
 * Templates for `corebrain setup` (self-host the CORE webapp locally).
 *
 * Single source of truth: hosting/docker/{docker-compose.yaml,.env.example}
 * on the `main` branch of github.com/RedPlanetHQ/core. Fetched at runtime.
 *
 * Provider list lives in @core/types — shared with the webapp's env validator.
 */

const COMPOSE_URL =
	'https://raw.githubusercontent.com/RedPlanetHQ/core/main/hosting/docker/docker-compose.yaml';

const ENV_EXAMPLE_URL =
	'https://raw.githubusercontent.com/RedPlanetHQ/core/main/hosting/docker/.env.example';

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

export async function fetchWebappComposeYaml(): Promise<string> {
	return fetchText(COMPOSE_URL, 'webapp docker-compose.yaml');
}

export async function fetchWebappEnvExample(): Promise<string> {
	return fetchText(ENV_EXAMPLE_URL, 'webapp .env.example');
}

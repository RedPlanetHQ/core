import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

interface NgrokTunnel {
	public_url: string;
	proto: 'https' | 'http';
	config: {addr: string};
}

interface NgrokTunnelsResponse {
	tunnels: NgrokTunnel[];
}

/**
 * Start `ngrok http <port>` and discover the public HTTPS URL via ngrok's
 * local API on 127.0.0.1:4040. Requires the `ngrok` CLI on PATH and an
 * auth token configured (`ngrok config add-authtoken <token>`).
 */
export async function startNgrok(port: number): Promise<{url: string; pid: number}> {
	const child = spawn('ngrok', ['http', String(port), '--log=stdout'], {
		stdio: 'ignore',
		detached: true,
	});
	child.unref();

	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		await sleep(500);
		try {
			const res = await fetch('http://127.0.0.1:4040/api/tunnels');
			if (!res.ok) continue;
			const json = (await res.json()) as NgrokTunnelsResponse;
			const tunnel = (json.tunnels ?? []).find((t) => t.proto === 'https');
			if (tunnel?.public_url) {
				return {url: tunnel.public_url, pid: child.pid ?? 0};
			}
		} catch {
			/* not up yet */
		}
	}

	throw new Error(
		'ngrok did not expose a public URL within 15s. Is the `ngrok` CLI installed and `ngrok config add-authtoken <token>` run?',
	);
}

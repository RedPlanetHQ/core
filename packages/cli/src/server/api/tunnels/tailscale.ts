import {spawn, exec as execCb} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execCb);

/**
 * Start `tailscale funnel` pointing at the given local port.
 * Requires:
 *  - `tailscale` CLI on PATH
 *  - Tailscale funnel enabled for the tailnet (see https://tailscale.com/kb/1223/funnel)
 * Returns the public HTTPS URL + the child process PID (for teardown).
 */
export async function startTailscaleFunnel(port: number): Promise<{url: string; pid: number}> {
	// Verify tailscale is installed
	try {
		await exec('command -v tailscale');
	} catch {
		throw new Error(
			'`tailscale` not found on PATH. Install from https://tailscale.com/download and run `tailscale login` first.',
		);
	}

	// Start funnel in background
	const child = spawn('tailscale', ['funnel', '--bg', String(port)], {
		stdio: 'ignore',
		detached: true,
	});
	child.unref();

	// Give tailscale a moment to register the funnel
	await new Promise((r) => setTimeout(r, 1500));

	// Fetch status to discover the public URL
	let url: string | null = null;
	for (let i = 0; i < 10; i++) {
		try {
			const {stdout} = await exec('tailscale funnel status');
			// Match the first https URL (tailscale prints the funnel mapping there)
			const match = stdout.match(/https:\/\/[^\s]+/);
			if (match) {
				url = match[0].replace(/[),\]]+$/, '');
				break;
			}
		} catch {
			/* transient; retry */
		}
		await new Promise((r) => setTimeout(r, 500));
	}

	if (!url) {
		throw new Error('tailscale funnel started but no public URL appeared within 5s');
	}

	return {url, pid: child.pid ?? 0};
}

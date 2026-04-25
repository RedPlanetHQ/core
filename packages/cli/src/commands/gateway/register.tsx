import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {hostname} from 'node:os';
import {getPreferences, updatePreferences} from '@/config/preferences';
import {generateSecurityKey, hashKey} from '@/server/api/auth';
import {startTailscaleFunnel} from '@/server/api/tunnels/tailscale';
import {startNgrok} from '@/server/api/tunnels/ngrok';

export const description =
	'Register this machine as a CORE gateway. Generates a securityKey and (optionally) brings up a tunnel.';

export const options = zod.object({
	name: zod.string().optional().describe('Gateway name (defaults to hostname)'),
	port: zod.number().int().positive().optional().describe('HTTP port (default 7787)'),
	tunnel: zod
		.enum(['tailscale', 'ngrok', 'none'])
		.optional()
		.describe('Tunnel to bring up for a public URL'),
	baseUrl: zod
		.string()
		.optional()
		.describe('Public URL, required when --tunnel none'),
});

type Props = {options: zod.infer<typeof options>};

export type RegisterOptions = zod.infer<typeof options>;

export type RegisterResult =
	| {ok: true; name: string; baseUrl: string; securityKey: string}
	| {ok: false; cancelled: true}
	| {ok: false; error: string};

/**
 * Core register flow. Pure async — returns a status object rather than
 * calling process.exit, so it can be chained from other commands (e.g. the
 * tail end of `gateway config`).
 */
export async function runRegister(opts: RegisterOptions): Promise<RegisterResult> {
	const prefs = getPreferences();
	const existing = prefs.gateway;

	const name = opts.name ?? existing?.name ?? `${hostname()}-gateway`;
	const port = opts.port ?? existing?.httpPort ?? 7787;

	const tunnelChoice =
		opts.tunnel ??
		(await p.select({
			message: 'How should the gateway be reachable from CORE?',
			options: [
				{value: 'tailscale', label: 'Tailscale funnel', hint: 'requires tailscale login + funnel enabled'},
				{value: 'ngrok', label: 'ngrok http tunnel', hint: 'requires ngrok authtoken configured'},
				{value: 'none', label: 'I will supply a public URL myself', hint: 'Railway / custom host'},
			],
			initialValue: 'tailscale',
		}));

	if (p.isCancel(tunnelChoice)) return {ok: false, cancelled: true};
	const tunnel = tunnelChoice as 'tailscale' | 'ngrok' | 'none';

	let baseUrl: string;
	let tunnelPid: number | undefined;

	if (tunnel === 'tailscale') {
		const spinner = p.spinner();
		spinner.start('Starting tailscale funnel...');
		try {
			const result = await startTailscaleFunnel(port);
			baseUrl = result.url;
			tunnelPid = result.pid;
			spinner.stop(chalk.green(`Tunnel up at ${baseUrl}`));
		} catch (err) {
			spinner.stop(chalk.red('Tailscale funnel failed.'));
			return {ok: false, error: err instanceof Error ? err.message : String(err)};
		}
	} else if (tunnel === 'ngrok') {
		const spinner = p.spinner();
		spinner.start('Starting ngrok...');
		try {
			const result = await startNgrok(port);
			baseUrl = result.url;
			tunnelPid = result.pid;
			spinner.stop(chalk.green(`Tunnel up at ${baseUrl}`));
		} catch (err) {
			spinner.stop(chalk.red('ngrok failed.'));
			return {ok: false, error: err instanceof Error ? err.message : String(err)};
		}
	} else {
		const provided =
			opts.baseUrl ??
			(await p.text({
				message: 'Public base URL (https://...)',
				placeholder: 'https://my-gateway.example.com',
				validate: (v) =>
					v && v.startsWith('http') ? undefined : 'URL must start with http:// or https://',
			}));
		if (p.isCancel(provided)) return {ok: false, cancelled: true};
		baseUrl = (provided as string).replace(/\/$/, '');
	}

	const securityKey = generateSecurityKey();
	const securityKeyHash = hashKey(securityKey);

	updatePreferences({
		gateway: {
			...(prefs.gateway ?? {pid: 0, startedAt: 0}),
			name,
			httpPort: port,
			httpBaseUrl: baseUrl,
			securityKeyHash,
			tunnelKind: tunnel,
			tunnelPid,
		},
	});

	p.note(
		[
			`${chalk.bold('name:')}        ${name}`,
			`${chalk.bold('baseUrl:')}     ${baseUrl}`,
			`${chalk.bold('securityKey:')} ${chalk.yellow(securityKey)}`,
			'',
			chalk.dim('Paste baseUrl + securityKey into CORE → Settings → Gateways.'),
			chalk.dim('This is the ONLY time the raw key is shown — it is not stored locally.'),
		].join('\n'),
		'Gateway registered',
	);

	return {ok: true, name, baseUrl, securityKey};
}

export default function RegisterCommand({options: opts}: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runRegister(opts)
			.then((res) => {
				if (!res.ok && 'error' in res) {
					p.log.error(res.error);
					process.exitCode = 1;
				}
				if (!res.ok && 'cancelled' in res) {
					p.cancel('Cancelled.');
				}
			})
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : String(err));
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit, opts]);
	return null;
}

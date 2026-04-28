import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {getPreferences} from '@/config/preferences';
import type {GatewayConfig} from '@/types/config';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	getServicePid,
} from '@/utils/service-manager/index';
import {getGatewayById, listGateways} from '@/server/api/gateways';

export const description =
	'Show gateway status. Without an id, shows the native gateway on this machine. With an id, fetches the row from CORE.';

export const options = zod.object({});

export const args = zod.tuple([
	zod.string().describe('Gateway id from `corebrain gateway list` (optional)').optional(),
]);

type Props = {
	options: zod.infer<typeof options>;
	args: zod.infer<typeof args>;
};

function formatUptime(startedAt: number): string {
	const uptimeMs = Date.now() - startedAt;
	const seconds = Math.floor(uptimeMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function getServiceTypeLabel(type: string): string {
	if (type === 'launchd') return 'launchd (macOS)';
	if (type === 'systemd') return 'systemd (Linux)';
	return 'unknown';
}

function statusBadge(status: string): string {
	if (status === 'CONNECTED') return chalk.green('● connected');
	if (status === 'DISCONNECTED') return chalk.red('○ disconnected');
	return chalk.dim(status);
}

async function runRemoteStatus(id: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Loading gateway ${id}...`);
	let row;
	try {
		row = await getGatewayById(id);
	} catch (err) {
		spinner.stop(chalk.red('Failed to load gateways from CORE'));
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
		return;
	}

	if (!row) {
		spinner.stop(chalk.yellow('Not found'));
		p.log.warn(`No gateway with id ${id} in this workspace.`);
		p.log.info('Run `corebrain gateway list` to see available gateways.');
		return;
	}
	spinner.stop(chalk.green('Found'));

	const prefs = getPreferences();
	const isLocal =
		(prefs.gateway?.name && prefs.gateway.name === row.name) ||
		(prefs.gateway?.httpBaseUrl && prefs.gateway.httpBaseUrl === row.baseUrl);

	const lines = [
		`${chalk.bold('Name:')}     ${row.name}${isLocal ? chalk.cyan(' (this machine)') : ''}`,
		`${chalk.bold('Id:')}       ${row.id}`,
		`${chalk.bold('Base URL:')} ${row.baseUrl}`,
		`${chalk.bold('Status:')}   ${statusBadge(row.status)}`,
		row.hostname ? `${chalk.bold('Host:')}     ${row.hostname}` : null,
		row.platform ? `${chalk.bold('Platform:')} ${row.platform}` : null,
	].filter(Boolean) as string[];

	if (isLocal) {
		const serviceType = getServiceType();
		if (serviceType !== 'none') {
			const serviceName = getServiceName();
			const installed = await isServiceInstalled(serviceName);
			if (installed) {
				const svcStatus = await getServiceStatus(serviceName);
				const pid = getServicePid(serviceName);
				lines.push('');
				lines.push(`${chalk.bold('Service:')}  ${getServiceTypeLabel(serviceType)}`);
				lines.push(`${chalk.bold('Service status:')} ${svcStatus === 'running' ? chalk.green('running') : chalk.yellow(svcStatus)}`);
				lines.push(`${chalk.bold('PID:')}      ${pid ?? 'unknown'}`);
				if (prefs.gateway?.startedAt) {
					lines.push(`${chalk.bold('Uptime:')}   ${formatUptime(prefs.gateway.startedAt)}`);
				}
			}
		}
	}

	p.note(lines.join('\n'), 'Gateway Status');
}

async function runLocalStatus(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking native gateway status...');

	const serviceType = getServiceType();

	if (serviceType === 'none') {
		spinner.stop(chalk.red('Not supported'));
		p.log.error('Service management not supported on this platform.');
		p.log.info('Pass a gateway id to inspect a remote gateway: `corebrain gateway status <id>`');
		return;
	}

	const serviceName = getServiceName();
	const installed = await isServiceInstalled(serviceName);

	if (!installed) {
		spinner.stop(chalk.yellow('Not installed'));
		p.log.warn('No native gateway on this machine.');
		p.log.info('Run `corebrain gateway setup` to create one, or `corebrain gateway list` to see registered gateways.');
		return;
	}

	const status = await getServiceStatus(serviceName);
	const running = status === 'running';

	if (!running) {
		spinner.stop(chalk.yellow('Stopped'));
		p.log.warn('Gateway installed but stopped.');
		p.log.info("Start with: corebrain gateway start");
		return;
	}

	const prefs = getPreferences();
	let pid: number | null = getServicePid(serviceName);
	if (!pid && prefs.gateway?.pid) {
		pid = prefs.gateway.pid;
	}

	spinner.stop(chalk.green('Running'));

	const gw: Partial<GatewayConfig> = prefs.gateway ?? {};
	const registered = Boolean(gw.securityKeyHash);
	const tunnelLine =
		gw.tunnelKind && gw.tunnelKind !== 'none'
			? `${chalk.bold('Tunnel:')} ${gw.tunnelKind}${gw.tunnelPid ? chalk.dim(` (pid ${gw.tunnelPid})`) : ''}`
			: `${chalk.bold('Tunnel:')} ${chalk.dim('none')}`;

	// Best-effort: try to find this gateway in the CORE workspace list to surface
	// a CONNECTED / DISCONNECTED badge alongside the local launchd state.
	let remoteBadge = '';
	try {
		const remotes = await listGateways();
		const match = remotes.find(
			r => (gw.name && r.name === gw.name) || (gw.httpBaseUrl && r.baseUrl === gw.httpBaseUrl),
		);
		if (match) {
			remoteBadge = `${chalk.bold('CORE:')}    ${statusBadge(match.status)} ${chalk.dim(`(id: ${match.id})`)}`;
		}
	} catch {
		// Silent — remote lookup is best-effort.
	}

	p.note(
		[
			`${chalk.bold('Status:')}  ${chalk.green('Running')}`,
			`${chalk.bold('Service:')} ${getServiceTypeLabel(serviceType)}`,
			`${chalk.bold('PID:')}     ${pid || 'unknown'}`,
			`${chalk.bold('Uptime:')}  ${gw.startedAt ? formatUptime(gw.startedAt) : 'unknown'}`,
			`${chalk.bold('HTTP port:')} ${gw.httpPort ?? chalk.dim('(default 7787)')}`,
			`${chalk.bold('Base URL:')} ${gw.httpBaseUrl || chalk.dim('(not registered)')}`,
			`${chalk.bold('Registered:')} ${registered ? chalk.green('yes') : chalk.yellow('no — run `corebrain gateway register`')}`,
			tunnelLine,
			remoteBadge || null,
			'',
			`${chalk.dim('Logs: ~/.corebrain/logs/gateway.log')}`,
		]
			.filter(Boolean)
			.join('\n'),
		'Gateway Status'
	);
}

export default function GatewayStatus({args: positional}: Props) {
	const {exit} = useApp();
	const id = positional?.[0];

	useEffect(() => {
		const run = id ? runRemoteStatus(id) : runLocalStatus();
		run
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit, id]);

	return null;
}

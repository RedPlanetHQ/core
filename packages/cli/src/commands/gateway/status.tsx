import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getPreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	getServicePid,
} from '@/utils/service-manager/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
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

async function runGatewayStatus(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking gateway status...');

	const serviceType = getServiceType();

	if (serviceType === 'none') {
		spinner.stop(chalk.red('Not supported'));
		p.log.error('Service management not supported on this platform.');
		return;
	}

	const serviceName = getServiceName();
	const installed = await isServiceInstalled(serviceName);

	if (!installed) {
		spinner.stop(chalk.yellow('Not installed'));
		p.log.warning('Gateway not installed.');
		p.log.info("Start with: corebrain gateway on");
		return;
	}

	const status = await getServiceStatus(serviceName);
	const running = status === 'running';

	if (!running) {
		spinner.stop(chalk.yellow('Stopped'));
		p.log.warning('Gateway installed but stopped.');
		p.log.info("Start with: corebrain gateway on");
		return;
	}

	// Get PID from service manager, fallback to preferences
	const prefs = getPreferences();
	let pid: number | null = getServicePid(serviceName);
	if (!pid && prefs.gateway?.pid) {
		pid = prefs.gateway.pid;
	}

	spinner.stop(chalk.green('Running'));

	p.note(
		[
			`${chalk.bold('Status:')} ${chalk.green('Running')}`,
			`${chalk.bold('Service:')} ${getServiceTypeLabel(serviceType)}`,
			`${chalk.bold('PID:')} ${pid || 'unknown'}`,
			`${chalk.bold('Uptime:')} ${prefs.gateway?.startedAt ? formatUptime(prefs.gateway.startedAt) : 'unknown'}`,
			'',
			`${chalk.dim('Logs: ~/.corebrain/logs/gateway.log')}`,
		].join('\n'),
		'Gateway Status'
	);
}

export default function GatewayStatus(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayStatus()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}

import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {getPreferences} from '@/config/preferences';
import {listGateways} from '@/server/api/gateways';

export const description = 'List all gateways registered with your CORE workspace.';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

function statusBadge(status: string): string {
	if (status === 'CONNECTED') return chalk.green('● connected');
	if (status === 'DISCONNECTED') return chalk.red('○ disconnected');
	return chalk.dim(status);
}

async function runList(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Loading gateways...');

	let gateways;
	try {
		gateways = await listGateways();
	} catch (err) {
		spinner.stop(chalk.red('Failed to load gateways'));
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
		return;
	}

	spinner.stop(`Found ${gateways.length} gateway${gateways.length === 1 ? '' : 's'}`);

	if (gateways.length === 0) {
		p.note(
			[
				'No gateways registered yet.',
				'',
				`Run ${chalk.cyan('corebrain gateway setup')} to add one.`,
			].join('\n'),
			'Gateways',
		);
		return;
	}

	const prefs = getPreferences();
	const localName = prefs.gateway?.name;
	const localUrl = prefs.gateway?.httpBaseUrl;

	const lines = gateways.map(g => {
		const isLocal =
			(localName && g.name === localName) ||
			(localUrl && g.baseUrl === localUrl);
		const marker = isLocal ? chalk.cyan(' (this machine)') : '';
		const platform = g.platform ? chalk.dim(` [${g.platform}]`) : '';
		return [
			`${chalk.bold(g.name)}${marker}${platform}`,
			`  ${chalk.dim('id:')}  ${g.id}`,
			`  ${chalk.dim('url:')} ${g.baseUrl}`,
			`  ${statusBadge(g.status)}`,
		].join('\n');
	});

	p.note(lines.join('\n\n'), 'Gateways');
}

export default function GatewayList(_props: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runList().finally(() => setTimeout(() => exit(), 100));
	}, [exit]);
	return null;
}

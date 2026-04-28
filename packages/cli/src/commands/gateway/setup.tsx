import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {setupDockerGateway} from '@/utils/setup/docker';
import {setupRailwayGateway} from '@/utils/setup/railway';

export const description =
	'Set up a new gateway and link it with CORE. Supports native (this machine), docker, and Railway.';

export const options = zod.object({
	kind: zod
		.enum(['native', 'docker', 'railway'])
		.optional()
		.describe('Skip the kind picker and go straight to native | docker | railway'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runSetup(opts: zod.infer<typeof options>): Promise<void> {
	let kind = opts.kind;
	if (!kind) {
		const choice = await p.select({
			message: 'Where will this gateway run?',
			options: [
				{
					value: 'native',
					label: 'Native — this machine',
					hint: 'launchd / systemd, full local browser + shell access',
				},
				{
					value: 'docker',
					label: 'Docker — local or remote host',
					hint: 'docker compose + optional Tailscale funnel',
				},
				{
					value: 'railway',
					label: 'Railway — managed cloud',
					hint: 'one-shot deploy via the Railway CLI (paid)',
				},
			],
			initialValue: 'native',
		});
		if (p.isCancel(choice)) {
			p.cancel('Setup cancelled');
			return;
		}
		kind = choice as 'native' | 'docker' | 'railway';
	}

	p.intro(chalk.bgCyan(chalk.black(` Gateway Setup — ${kind} `)));

	if (kind === 'native') {
		// Lazy-import to avoid pulling Ink wizard deps for non-native paths.
		const {runInteractiveConfig} = await import('./config');
		const result = await runInteractiveConfig();
		if ('cancelled' in result && result.cancelled) {
			p.cancel('Setup cancelled');
		}
		return;
	}

	if (kind === 'docker') {
		const result = await setupDockerGateway();
		if ('cancelled' in result) {
			p.cancel('Setup cancelled');
		}
		return;
	}

	if (kind === 'railway') {
		const result = await setupRailwayGateway();
		if ('cancelled' in result) {
			p.cancel('Setup cancelled');
		}
		return;
	}
}

export default function GatewaySetup({options: opts}: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runSetup(opts)
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : String(err));
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit, opts]);
	return null;
}

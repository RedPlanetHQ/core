import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runListAgents(): Promise<void> {
	if (!requireNativeGateway()) return;
	const result = await executeCodingTool('coding_list_agents', {});

	if (!result.success) {
		p.log.error(result.error || 'Unknown error');
		return;
	}

	const res = result.result as {agents: {name: string; isDefault: boolean}[]; default: string | null};

	if (res.agents.length === 0) {
		p.log.info('No coding agents configured.');
		p.log.info("Run 'corebrain coding setup' to configure one.");
		return;
	}

	const lines = res.agents.map((a) =>
		a.isDefault
			? `${chalk.green('✓')} ${chalk.bold(a.name)}  ${chalk.dim('(default)')}`
			: `  ${chalk.dim(a.name)}`,
	);

	p.note(lines.join('\n'), 'Configured Agents');
}

export default function CodingAgents(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runListAgents()
			.catch((err) => p.log.error(err instanceof Error ? err.message : 'Unknown error'))
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit]);

	return null;
}

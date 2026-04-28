import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {setupLocalWebapp} from '@/utils/setup/local';

export const description =
	'Self-host CORE locally with Docker. Drops a docker-compose.yaml + .env into a directory you choose, then brings it up.';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runSetup(): Promise<void> {
	p.intro(chalk.bgCyan(chalk.black(' CORE — Local Self-Host ')));
	const result = await setupLocalWebapp();
	if ('cancelled' in result) {
		p.cancel('Setup cancelled');
	}
}

export default function SetupCommand(_props: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runSetup()
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : String(err));
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit]);
	return null;
}

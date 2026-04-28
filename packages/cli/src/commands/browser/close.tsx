import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {closeAllSessions} from '@/utils/browser-manager';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runCloseAll(): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start('Closing all browser sessions...');
	await closeAllSessions();
	spinner.stop(chalk.green('All browser sessions closed'));
}

export default function BrowserClose(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCloseAll()
			.catch(err => {
				p.log.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}

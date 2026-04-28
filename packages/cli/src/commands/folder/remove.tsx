import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {removeFolder} from '@/config/folders';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([
	zod.string().describe('Folder id or name to remove'),
]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

function runFolderRemove(idOrName: string): void {
	if (!requireNativeGateway()) return;
	try {
		removeFolder(idOrName);
		p.log.success(chalk.green(`Folder removed: ${idOrName}`));
	} catch (err) {
		p.log.error(
			chalk.red(err instanceof Error ? err.message : 'Unknown error'),
		);
		process.exitCode = 1;
	}
}

export default function FolderRemoveCommand({args: cmdArgs}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runFolderRemove(cmdArgs[0]);
		setTimeout(() => exit(), 100);
	}, [cmdArgs, exit]);

	return null;
}

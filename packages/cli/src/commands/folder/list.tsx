import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {listFolders} from '@/config/folders';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

function runFolderList(): void {
	const folders = listFolders();
	if (folders.length === 0) {
		p.log.info(chalk.dim('No folders registered. Use `corebrain folder add <path>`.'));
		return;
	}

	const rows = folders.map(f => {
		const scopes = f.scopes.map(s => chalk.cyan(s)).join(',');
		const git = f.gitRepo ? chalk.green('git') : chalk.dim('-');
		return [
			`${chalk.bold(f.name)} ${chalk.dim('(' + f.id + ')')}`,
			`  ${chalk.dim('path:')} ${f.path}`,
			`  ${chalk.dim('scopes:')} ${scopes}   ${chalk.dim('repo:')} ${git}`,
		].join('\n');
	});

	p.note(rows.join('\n\n'), `Registered folders (${folders.length})`);
}

export default function FolderListCommand(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		try {
			runFolderList();
		} catch (err) {
			p.log.error(
				`Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
			);
			process.exitCode = 1;
		}
		setTimeout(() => exit(), 100);
	}, [exit]);

	return null;
}

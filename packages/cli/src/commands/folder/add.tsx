import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {addFolder} from '@/config/folders';
import type {StoredFolder} from '@/types/config';

const SCOPE_VALUES = ['files', 'coding', 'exec'] as const;
type Scope = (typeof SCOPE_VALUES)[number];

export const args = zod.tuple([
	zod
		.string()
		.optional()
		.describe(
			'Absolute or relative path to the folder to register (defaults to the current directory)',
		),
]);

export const options = zod.object({
	scopes: zod
		.string()
		.optional()
		.describe('Comma-separated scopes: files,coding,exec'),
	name: zod.string().optional().describe('Folder name (defaults to basename)'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

function parseScopes(raw: string): Scope[] {
	const parts = raw
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
	for (const s of parts) {
		if (!SCOPE_VALUES.includes(s as Scope)) {
			throw new Error(
				`Invalid scope "${s}". Allowed: ${SCOPE_VALUES.join(', ')}`,
			);
		}
	}
	return parts as Scope[];
}

function formatFolder(folder: StoredFolder): string {
	return [
		`${chalk.bold('id:')} ${folder.id}`,
		`${chalk.bold('name:')} ${folder.name}`,
		`${chalk.bold('path:')} ${folder.path}`,
		`${chalk.bold('scopes:')} ${folder.scopes.join(', ')}`,
		`${chalk.bold('gitRepo:')} ${folder.gitRepo ? 'yes' : 'no'}`,
	].join('\n');
}

async function runFolderAdd(
	path: string,
	opts: zod.infer<typeof options>,
): Promise<void> {
	const scopes: Scope[] = opts.scopes
		? parseScopes(opts.scopes)
		: [...SCOPE_VALUES];

	try {
		const folder = addFolder({path, scopes, name: opts.name});
		p.log.success(chalk.green(`Folder registered: ${folder.name}`));
		p.note(formatFolder(folder), 'Folder');
	} catch (err) {
		p.log.error(
			chalk.red(err instanceof Error ? err.message : 'Unknown error'),
		);
		process.exitCode = 1;
	}
}

export default function FolderAddCommand({args: cmdArgs, options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		const path = cmdArgs[0] && cmdArgs[0].trim() ? cmdArgs[0] : process.cwd();
		runFolderAdd(path, opts)
			.catch(err => {
				p.log.error(
					`Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
				process.exitCode = 1;
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [cmdArgs, opts, exit]);

	return null;
}

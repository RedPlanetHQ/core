import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {updateScopes} from '@/config/folders';

const SCOPE_VALUES = ['files', 'coding', 'exec'] as const;
type Scope = (typeof SCOPE_VALUES)[number];

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([
	zod.string().describe('Folder id or name to modify'),
]);

export const options = zod.object({
	add: zod.string().optional().describe('Scopes to add (comma-separated)'),
	remove: zod
		.string()
		.optional()
		.describe('Scopes to remove (comma-separated)'),
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

function runFolderScope(
	idOrName: string,
	opts: zod.infer<typeof options>,
): void {
	if (!requireNativeGateway()) return;
	if (!opts.add && !opts.remove) {
		p.log.error(
			chalk.red('Specify at least one of --add or --remove'),
		);
		process.exitCode = 1;
		return;
	}

	try {
		const add = opts.add ? parseScopes(opts.add) : undefined;
		const remove = opts.remove ? parseScopes(opts.remove) : undefined;
		const updated = updateScopes(idOrName, {add, remove});
		p.log.success(chalk.green(`Updated scopes for ${updated.name}`));
		p.note(
			[
				`${chalk.bold('id:')} ${updated.id}`,
				`${chalk.bold('name:')} ${updated.name}`,
				`${chalk.bold('path:')} ${updated.path}`,
				`${chalk.bold('scopes:')} ${updated.scopes.join(', ')}`,
			].join('\n'),
			'Folder',
		);
	} catch (err) {
		p.log.error(
			chalk.red(err instanceof Error ? err.message : 'Unknown error'),
		);
		process.exitCode = 1;
	}
}

export default function FolderScopeCommand({args: cmdArgs, options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runFolderScope(cmdArgs[0], opts);
		setTimeout(() => exit(), 100);
	}, [cmdArgs, opts, exit]);

	return null;
}

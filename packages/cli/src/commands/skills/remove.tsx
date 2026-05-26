import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {removeSkill} from '@/server/skills/install';
import {requireNativeGateway} from '@/utils/require-native-gateway';

export const args = zod.tuple([zod.string().describe('Skill name to remove')]);
export const options = zod.object({
	yes: zod.boolean().optional().describe('Skip the interactive confirmation'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runSkillsRemove(name: string, opts: zod.infer<typeof options>): Promise<void> {
	if (!requireNativeGateway()) return;

	if (!opts.yes) {
		const confirmed = await p.confirm({
			message: `Remove skill "${name}"? This deletes ~/.corebrain/skills/${name} recursively.`,
			initialValue: false,
		});
		if (!confirmed || p.isCancel(confirmed)) {
			p.log.info(chalk.dim('cancelled'));
			return;
		}
	}

	await removeSkill(name);
	p.log.success(chalk.green(`Removed skill: ${name}`));
}

export default function SkillsRemoveCommand({args: cmdArgs, options: opts}: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runSkillsRemove(cmdArgs[0], opts)
			.catch((err) => {
				p.log.error(`Error: ${err instanceof Error ? err.message : 'unknown'}`);
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [cmdArgs, opts, exit]);
	return null;
}

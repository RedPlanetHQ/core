import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {listSkills} from '@/server/skills/skill-store';
import {requireNativeGateway} from '@/utils/require-native-gateway';

export const options = zod.object({});
type Props = {options: zod.infer<typeof options>};

async function runSkillsList(): Promise<void> {
	if (!requireNativeGateway()) return;
	const skills = await listSkills();
	if (skills.length === 0) {
		p.log.info(
			chalk.dim(
				'No skills installed. Use `corebrain skills install <url>` to add one.',
			),
		);
		return;
	}

	const rows = skills.map((s) => {
		const at = s.allowedTools?.length
			? `  ${chalk.dim('allowed-tools:')} ${s.allowedTools.join(', ')}`
			: '';
		return [
			`${chalk.bold(s.name)}`,
			`  ${chalk.dim('description:')} ${s.description}`,
			`  ${chalk.dim('path:')} ${s.path}`,
			at,
		]
			.filter(Boolean)
			.join('\n');
	});

	p.note(rows.join('\n\n'), `Installed skills (${skills.length})`);
}

export default function SkillsListCommand(_props: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runSkillsList()
			.catch((err) => {
				p.log.error(`Error: ${err instanceof Error ? err.message : 'unknown'}`);
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [exit]);
	return null;
}

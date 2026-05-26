import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {installSkill} from '@/server/skills/install';
import {DEFAULT_SKILLS_DIR} from '@/server/skills/skill-store';
import {getBuiltin, BUILTIN_SKILLS} from '@/server/skills/builtins';
import {requireNativeGateway} from '@/utils/require-native-gateway';

export const args = zod.tuple([
	zod
		.string()
		.describe(
			'Git URL of the skill repo, or "builtin:<name>" (e.g. "builtin:find-skills")',
		),
]);

export const options = zod.object({
	skill: zod
		.string()
		.optional()
		.describe('Subfolder in the repo that contains the SKILL.md (when the repo holds multiple skills)'),
	force: zod
		.boolean()
		.optional()
		.describe('Overwrite an existing skill with the same name'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function installBuiltin(name: string, force: boolean): Promise<void> {
	const builtin = getBuiltin(name);
	if (!builtin) {
		const known = BUILTIN_SKILLS.map((b) => b.name).join(', ') || '(none)';
		throw new Error(
			`Unknown builtin "${name}". Available builtins: ${known}.`,
		);
	}

	const dst = join(DEFAULT_SKILLS_DIR, builtin.name);
	if (existsSync(dst) && !force) {
		throw new Error(
			`Skill '${builtin.name}' already installed. Use --force to overwrite, or 'corebrain skills remove ${builtin.name}' first.`,
		);
	}

	mkdirSync(dst, {recursive: true});
	writeFileSync(join(dst, 'SKILL.md'), builtin.skillMd);
}

async function runSkillsInstall(
	target: string,
	opts: zod.infer<typeof options>,
): Promise<void> {
	if (!requireNativeGateway()) return;

	if (target.startsWith('builtin:')) {
		const name = target.slice('builtin:'.length);
		await installBuiltin(name, !!opts.force);
		p.log.success(chalk.green(`Installed builtin skill: ${name}`));
		return;
	}

	const result = await installSkill({
		source: 'url',
		url: target,
		skill: opts.skill,
		force: opts.force,
	});
	p.log.success(chalk.green(`Installed skill: ${result.name}`));
	p.note(
		[
			`${chalk.bold('name:')} ${result.name}`,
			`${chalk.bold('description:')} ${result.description}`,
			`${chalk.bold('path:')} ${result.path}`,
		].join('\n'),
		'Skill',
	);
}

export default function SkillsInstallCommand({args: cmdArgs, options: opts}: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runSkillsInstall(cmdArgs[0], opts)
			.catch((err) => {
				p.log.error(
					`Error: ${err instanceof Error ? err.message : 'unknown'}`,
				);
				process.exitCode = 1;
			})
			.finally(() => setTimeout(() => exit(), 100));
	}, [cmdArgs, opts, exit]);
	return null;
}

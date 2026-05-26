import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {copyFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSkill} from '@/server/skills/install';
import {DEFAULT_SKILLS_DIR} from '@/server/skills/skill-store';
import {requireNativeGateway} from '@/utils/require-native-gateway';

export const args = zod.tuple([
	zod.string().describe('Git URL of the skill repo, or "builtin:find-skills"'),
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

// Resolve the bundled builtin template path. The template lives next to the
// source tree under server/skills/builtin and is copied to dist by the build.
function builtinPath(name: string): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// From `dist/commands/skills/install.js` walk to dist root, then to server/skills/builtin.
	return resolve(here, '..', '..', 'server', 'skills', 'builtin', name);
}

async function installBuiltinFindSkills(force: boolean): Promise<void> {
	const src = builtinPath('find-skills');
	const dst = join(DEFAULT_SKILLS_DIR, 'find-skills');
	if (existsSync(dst) && !force) {
		throw new Error(
			`Skill 'find-skills' already installed. Use --force to overwrite, or 'corebrain skills remove find-skills' first.`,
		);
	}
	mkdirSync(DEFAULT_SKILLS_DIR, {recursive: true});
	mkdirSync(dst, {recursive: true});
	copyFileSync(join(src, 'SKILL.md'), join(dst, 'SKILL.md'));
}

async function runSkillsInstall(
	target: string,
	opts: zod.infer<typeof options>,
): Promise<void> {
	if (!requireNativeGateway()) return;

	if (target === 'builtin:find-skills') {
		await installBuiltinFindSkills(!!opts.force);
		p.log.success(chalk.green('Installed builtin skill: find-skills'));
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

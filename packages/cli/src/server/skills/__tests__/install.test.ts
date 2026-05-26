import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSkill, removeSkill} from '../install';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'corebrain-skills-install-test-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

const fixtureSkillMd = (name: string, desc: string) =>
	`---\nname: ${name}\ndescription: ${desc}\n---\n\n# body\n`;

describe('installSkill (files)', () => {
	it('writes a single SKILL.md and returns the installed shape', async () => {
		const result = await installSkill(
			{
				source: 'files',
				name: 'deploy-fly',
				files: {'SKILL.md': fixtureSkillMd('deploy-fly', 'Deploys a Fly app')},
			},
			{dir: root},
		);

		expect(result).toEqual({
			name: 'deploy-fly',
			description: 'Deploys a Fly app',
			path: join(root, 'deploy-fly'),
		});
		expect(existsSync(join(root, 'deploy-fly', 'SKILL.md'))).toBe(true);
	});

	it('writes nested files preserving relative paths', async () => {
		await installSkill(
			{
				source: 'files',
				name: 'with-scripts',
				files: {
					'SKILL.md': fixtureSkillMd('with-scripts', 'has a script'),
					'scripts/rollback.sh': '#!/bin/sh\necho rollback\n',
				},
			},
			{dir: root},
		);

		const script = readFileSync(
			join(root, 'with-scripts', 'scripts', 'rollback.sh'),
			'utf8',
		);
		expect(script).toContain('echo rollback');
	});

	it('rejects names with path traversal characters', async () => {
		await expect(
			installSkill(
				{
					source: 'files',
					name: '../escape',
					files: {'SKILL.md': fixtureSkillMd('../escape', 'bad')},
				},
				{dir: root},
			),
		).rejects.toThrow(/invalid skill name/i);
	});

	it('rejects file paths that escape the skill directory', async () => {
		await expect(
			installSkill(
				{
					source: 'files',
					name: 'sneaky',
					files: {
						'SKILL.md': fixtureSkillMd('sneaky', 'ok'),
						'../outside.txt': 'no',
					},
				},
				{dir: root},
			),
		).rejects.toThrow(/file path escapes/i);
	});

	it('rejects when frontmatter name does not match the install name', async () => {
		await expect(
			installSkill(
				{
					source: 'files',
					name: 'a',
					files: {'SKILL.md': fixtureSkillMd('b', 'mismatch')},
				},
				{dir: root},
			),
		).rejects.toThrow(/name.*does not match/i);
	});

	it('rejects when a skill with the same name already exists (no force)', async () => {
		await installSkill(
			{
				source: 'files',
				name: 'twice',
				files: {'SKILL.md': fixtureSkillMd('twice', 'first')},
			},
			{dir: root},
		);
		await expect(
			installSkill(
				{
					source: 'files',
					name: 'twice',
					files: {'SKILL.md': fixtureSkillMd('twice', 'second')},
				},
				{dir: root},
			),
		).rejects.toThrow(/already installed/i);
	});

	it('overwrites with force: true', async () => {
		await installSkill(
			{
				source: 'files',
				name: 'twice',
				files: {'SKILL.md': fixtureSkillMd('twice', 'first')},
			},
			{dir: root},
		);
		const result = await installSkill(
			{
				source: 'files',
				name: 'twice',
				force: true,
				files: {'SKILL.md': fixtureSkillMd('twice', 'second')},
			},
			{dir: root},
		);
		expect(result.description).toBe('second');
	});
});

describe('removeSkill', () => {
	it('deletes the skill directory', async () => {
		await installSkill(
			{
				source: 'files',
				name: 'to-remove',
				files: {'SKILL.md': fixtureSkillMd('to-remove', 'bye')},
			},
			{dir: root},
		);
		await removeSkill('to-remove', {dir: root});
		expect(existsSync(join(root, 'to-remove'))).toBe(false);
	});

	it('throws on unknown skill', async () => {
		await expect(removeSkill('does-not-exist', {dir: root})).rejects.toThrow(
			/not found/i,
		);
	});

	it('rejects names with path traversal', async () => {
		await expect(removeSkill('../escape', {dir: root})).rejects.toThrow(
			/invalid skill name/i,
		);
	});
});

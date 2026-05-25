import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listSkills} from '../skill-store';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'corebrain-skills-test-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function writeSkill(name: string, frontmatter: string, body = '# body\n') {
	const dir = join(root, name);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`);
}

describe('listSkills', () => {
	it('returns [] when the skills directory is empty', async () => {
		const result = await listSkills(root);
		expect(result).toEqual([]);
	});

	it('returns [] when the skills directory does not exist', async () => {
		const result = await listSkills(join(root, 'does-not-exist'));
		expect(result).toEqual([]);
	});

	it('lists a single valid skill with absolute path', async () => {
		writeSkill('deploy-fly', 'name: deploy-fly\ndescription: Deploy a Fly app');
		const result = await listSkills(root);
		expect(result).toEqual([
			{
				name: 'deploy-fly',
				description: 'Deploy a Fly app',
				path: join(root, 'deploy-fly'),
			},
		]);
	});

	it('parses optional allowed-tools', async () => {
		writeSkill(
			'summarize-prs',
			'name: summarize-prs\ndescription: Summarize PRs\nallowed-tools: [exec_command, files_read]',
		);
		const result = await listSkills(root);
		expect(result[0]?.allowedTools).toEqual(['exec_command', 'files_read']);
	});

	it('skips entries missing required frontmatter', async () => {
		writeSkill('no-name', 'description: missing name');
		writeSkill('no-desc', 'name: no-desc');
		writeSkill('good', 'name: good\ndescription: ok');
		const result = await listSkills(root);
		expect(result.map((s) => s.name)).toEqual(['good']);
	});

	it('skips entries where frontmatter name does not match directory', async () => {
		writeSkill('expected-foo', 'name: wrong-name\ndescription: mismatch');
		const result = await listSkills(root);
		expect(result).toEqual([]);
	});

	it('sorts results alphabetically by name', async () => {
		writeSkill('zeta', 'name: zeta\ndescription: z');
		writeSkill('alpha', 'name: alpha\ndescription: a');
		writeSkill('mu', 'name: mu\ndescription: m');
		const result = await listSkills(root);
		expect(result.map((s) => s.name)).toEqual(['alpha', 'mu', 'zeta']);
	});
});

import zod from 'zod';
import {readFile} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {DEFAULT_SKILLS_DIR} from '@/server/skills/skill-store';
import {installSkill} from '@/server/skills/install';
import type {GatewayTool} from './browser-tools';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const LoadSchema = zod.object({
	name: zod.string(),
	file: zod.string().optional(),
});

const CreateSchema = zod.object({
	name: zod.string(),
	description: zod.string().min(1),
	body: zod.string().min(1),
	allowed_tools: zod.array(zod.string()).optional(),
	force: zod.boolean().optional(),
});

const UpdateSchema = zod.object({
	name: zod.string(),
	body: zod.string().min(1),
});

const jsonSchemas = {
	load_skill: {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string',
				description:
					'Skill name (kebab-case slug, matching one of the entries in the gateway manifest `skills` list).',
			},
			file: {
				type: 'string',
				description:
					'Relative path within the skill dir. Defaults to "SKILL.md". Use this to read supporting files referenced from a skill.',
			},
		},
		required: ['name'],
	},
	create_skill: {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string',
				description:
					'Kebab-case skill slug. Becomes both the SKILL.md frontmatter `name` and the directory under ~/.corebrain/skills/.',
			},
			description: {
				type: 'string',
				description:
					'One-line description shown to the agent in the AVAILABLE SKILLS block. Write it as a trigger ("Use when ...").',
			},
			body: {
				type: 'string',
				description:
					'Markdown body of the SKILL.md (everything after the YAML frontmatter). Do NOT include `---` fences — the caller wraps the frontmatter for you.',
			},
			allowed_tools: {
				type: 'array',
				items: {type: 'string'},
				description:
					'Optional list of gateway tools this skill uses (e.g. ["coding_ask", "exec_command"]). Informational only.',
			},
			force: {
				type: 'boolean',
				description:
					'If true, overwrite an existing skill with the same name. Use this when you intend to fully replace the skill rather than append (use update_skill to append).',
			},
		},
		required: ['name', 'description', 'body'],
	},
	update_skill: {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string',
				description:
					'Skill name to update (must already exist under ~/.corebrain/skills/).',
			},
			body: {
				type: 'string',
				description:
					'New body content to APPEND to the existing SKILL.md (after the frontmatter). The frontmatter is preserved. Pass only what is new.',
			},
		},
		required: ['name', 'body'],
	},
};

export const skillsTools: GatewayTool[] = [
	{
		name: 'load_skill',
		description:
			"Load a gateway skill's content. Defaults to its SKILL.md. Use the name from the gateway's skills list — the skills directory is not reachable via files_read.",
		inputSchema: jsonSchemas.load_skill,
	},
	{
		name: 'create_skill',
		description:
			"Create a new gateway skill under ~/.corebrain/skills/<name>/SKILL.md. The caller writes the body in plain markdown; frontmatter (name, description, allowed-tools) is generated from the tool args. Fails if a skill with the same name already exists unless force=true. Use update_skill to append to an existing skill instead.",
		inputSchema: jsonSchemas.create_skill,
	},
	{
		name: 'update_skill',
		description:
			"Append content to an existing gateway skill's SKILL.md. Body is APPENDED after the existing body; frontmatter and prior content are preserved. Pass only what is new — do not re-send the whole skill.",
		inputSchema: jsonSchemas.update_skill,
	},
];

function buildFrontmatter(opts: {
	name: string;
	description: string;
	allowedTools?: string[];
}): string {
	const desc = opts.description
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, ' ');
	const lines: string[] = ['---', `name: ${opts.name}`, `description: "${desc}"`];
	if (opts.allowedTools && opts.allowedTools.length > 0) {
		lines.push(`allowed-tools: [${opts.allowedTools.join(', ')}]`);
	}
	lines.push('---', '');
	return lines.join('\n');
}

function splitFrontmatter(content: string): {frontmatter: string; body: string} {
	if (!content.startsWith('---')) {
		return {frontmatter: '', body: content};
	}
	const end = content.indexOf('\n---', 3);
	if (end === -1) return {frontmatter: '', body: content};
	const headerEnd = end + 4; // include the closing '\n---'
	// Consume one trailing newline after the closing fence if present.
	const afterFence = content[headerEnd] === '\n' ? headerEnd + 1 : headerEnd;
	return {
		frontmatter: content.slice(0, afterFence),
		body: content.slice(afterFence),
	};
}

async function handleLoad(params: zod.infer<typeof LoadSchema>) {
	if (!NAME_RE.test(params.name)) {
		return {
			success: false,
			error: `invalid skill name "${params.name}" — must match ${NAME_RE}`,
		};
	}

	const skillDir = join(DEFAULT_SKILLS_DIR, params.name);
	if (!existsSync(skillDir)) {
		return {success: false, error: `skill not found: ${params.name}`};
	}

	const rel = params.file ?? 'SKILL.md';
	if (isAbsolute(rel) || rel.startsWith('/')) {
		return {success: false, error: `file path must be relative: "${rel}"`};
	}
	const abs = resolve(skillDir, rel);
	const back = relative(skillDir, abs);
	if (back.startsWith('..') || isAbsolute(back)) {
		return {success: false, error: `file path escapes skill dir: "${rel}"`};
	}

	try {
		const content = await readFile(abs, 'utf8');
		return {
			success: true,
			result: {
				name: params.name,
				file: rel,
				path: abs,
				content,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function handleCreate(params: zod.infer<typeof CreateSchema>) {
	if (!NAME_RE.test(params.name)) {
		return {
			success: false,
			error: `invalid skill name "${params.name}" — must match ${NAME_RE}`,
		};
	}

	const frontmatter = buildFrontmatter({
		name: params.name,
		description: params.description,
		allowedTools: params.allowed_tools,
	});
	const skillMd = frontmatter + params.body.trim() + '\n';

	try {
		const skill = await installSkill({
			source: 'files',
			name: params.name,
			files: {'SKILL.md': skillMd},
			...(params.force ? {force: true} : {}),
		});
		return {success: true, result: skill};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function handleUpdate(params: zod.infer<typeof UpdateSchema>) {
	if (!NAME_RE.test(params.name)) {
		return {
			success: false,
			error: `invalid skill name "${params.name}" — must match ${NAME_RE}`,
		};
	}

	const skillMdPath = join(DEFAULT_SKILLS_DIR, params.name, 'SKILL.md');
	if (!existsSync(skillMdPath)) {
		return {
			success: false,
			error: `skill not found: ${params.name} (use create_skill to make a new one)`,
		};
	}

	let current: string;
	try {
		current = await readFile(skillMdPath, 'utf8');
	} catch (err) {
		return {
			success: false,
			error: `failed to read existing SKILL.md: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const {frontmatter, body: existingBody} = splitFrontmatter(current);
	const mergedBody =
		(existingBody.trimEnd() + '\n\n' + params.body.trim() + '\n');
	const newContent = (frontmatter || '') + mergedBody;

	try {
		const skill = await installSkill({
			source: 'files',
			name: params.name,
			files: {'SKILL.md': newContent},
			force: true,
		});
		return {success: true, result: skill};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function executeSkillsTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'load_skill':
				return await handleLoad(LoadSchema.parse(params));
			case 'create_skill':
				return await handleCreate(CreateSchema.parse(params));
			case 'update_skill':
				return await handleUpdate(UpdateSchema.parse(params));

			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}

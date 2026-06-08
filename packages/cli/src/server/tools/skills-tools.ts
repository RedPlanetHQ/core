import zod from 'zod';
import {installSkill, removeSkill} from '@/server/skills/install';

interface GatewayTool {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
}

interface ToolResult {
	success: boolean;
	result?: unknown;
	error?: string;
}

const InstallSchema = zod.object({
	url: zod.string().min(1),
	name: zod.string().min(1),
	subdir: zod.string().optional(),
	force: zod.boolean().optional(),
});

const RemoveSchema = zod.object({
	name: zod.string().min(1),
});

const jsonSchemas: Record<string, Record<string, unknown>> = {
	skill_install: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'Git URL of the source repository. Must start with "https://" or "git@host:". For library skills this points at the CORE monorepo.',
			},
			name: {
				type: 'string',
				description:
					'Kebab-case skill slug. Becomes both the SKILL.md frontmatter `name` and the directory under ~/.corebrain/skills/.',
			},
			subdir: {
				type: 'string',
				description:
					'Optional path inside the cloned repo to the skill folder (e.g. "docs/skills/my-skill"). Triggers sparse-checkout so only this subtree is fetched. Omit for repos whose root is the skill.',
			},
			force: {
				type: 'boolean',
				description:
					'If true, overwrite an existing skill with the same name. Without this an existing install fails.',
			},
		},
		required: ['url', 'name'],
	},
	skill_remove: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Skill name to remove. Deletes ~/.corebrain/skills/<name>/ recursively.',
			},
		},
		required: ['name'],
	},
};

export const skillsTools: GatewayTool[] = [
	{
		name: 'skill_install',
		description:
			'Install a skill from a git URL into ~/.corebrain/skills/<name>/. Uses sparse-checkout when `subdir` is set, so library skills nested inside a monorepo can be pulled cheaply. Atomic: stages in a temp dir, then renames into place.',
		inputSchema: jsonSchemas.skill_install,
	},
	{
		name: 'skill_remove',
		description:
			'Remove an installed skill. Deletes ~/.corebrain/skills/<name>/ recursively. Fails if the skill does not exist.',
		inputSchema: jsonSchemas.skill_remove,
	},
];

async function handleInstall(params: zod.infer<typeof InstallSchema>): Promise<ToolResult> {
	try {
		const skill = await installSkill({
			source: 'url',
			url: params.url,
			name: params.name,
			...(params.subdir ? {subdir: params.subdir} : {}),
			...(params.force ? {force: true} : {}),
		});
		return {success: true, result: skill};
	} catch (err) {
		return {success: false, error: err instanceof Error ? err.message : String(err)};
	}
}

async function handleRemove(params: zod.infer<typeof RemoveSchema>): Promise<ToolResult> {
	try {
		await removeSkill(params.name);
		return {success: true, result: {name: params.name, removed: true}};
	} catch (err) {
		return {success: false, error: err instanceof Error ? err.message : String(err)};
	}
}

export async function executeSkillsTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<ToolResult> {
	try {
		switch (toolName) {
			case 'skill_install':
				return await handleInstall(InstallSchema.parse(params));
			case 'skill_remove':
				return await handleRemove(RemoveSchema.parse(params));
			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {success: false, error: err instanceof Error ? err.message : 'Unknown error'};
	}
}

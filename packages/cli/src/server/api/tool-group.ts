import type {FastifyPluginAsync} from 'fastify';

interface ToolMeta {
	name: string;
	description: string;
}

interface ToolResult {
	success: boolean;
	result?: unknown;
	error?: string;
}

type Executor = (
	toolName: string,
	params: Record<string, unknown>,
) => Promise<ToolResult> | ToolResult;

/**
 * Build a Fastify plugin that exposes one POST route per tool in `tools`,
 * each at path `/{tool.name}` — e.g. /api/coding/coding_ask.
 *
 * The plugin is meant to be registered with a prefix:
 *   app.register(makeToolGroupRoutes(codingTools, executeCodingTool), { prefix: '/api/coding' });
 */
export function makeToolGroupRoutes(
	tools: ToolMeta[],
	execute: Executor,
): FastifyPluginAsync {
	return async (app) => {
		for (const tool of tools) {
			app.post(`/${tool.name}`, async (req, reply) => {
				const params = (req.body as Record<string, unknown> | null) ?? {};
				const result = await execute(tool.name, params);
				if (!result.success) {
					reply.code(400);
					return {ok: false, error: {code: 'TOOL_ERROR', message: result.error ?? 'unknown'}};
				}
				return {ok: true, result: result.result};
			});
		}
	};
}

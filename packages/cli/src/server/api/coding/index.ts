import type {FastifyPluginAsync} from 'fastify';
import {codingTools, executeCodingTool} from '@/server/tools/coding-tools';
import {makeToolGroupRoutes} from '../tool-group';
import {xtermSessionRoute} from './coding_xterm_session';
import {codingSpawnRoute} from './coding_spawn';

/**
 * Mounted at `/api/coding`. Registers one POST route per coding tool, the
 * xterm WebSocket attach route, and the webapp-only `spawn` primitive used
 * by the new coding session flow. Agent authentication is set up via env
 * vars (`CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`) at gateway boot — no
 * web UI for it.
 */
export const codingRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(codingTools, executeCodingTool));
	await app.register(xtermSessionRoute);
	await app.register(codingSpawnRoute);
};

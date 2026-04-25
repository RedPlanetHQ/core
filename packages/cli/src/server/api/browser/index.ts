import type {FastifyPluginAsync} from 'fastify';
import {browserTools, executeBrowserTool} from '@/server/tools/browser-tools';
import {makeToolGroupRoutes} from '../tool-group';

export const browserRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(browserTools, executeBrowserTool));
};

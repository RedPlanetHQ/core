import type {FastifyPluginAsync} from 'fastify';
import {execTools, executeExecTool} from '@/server/tools/exec-tools';
import {makeToolGroupRoutes} from '../tool-group';

export const execRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(execTools, executeExecTool));
};

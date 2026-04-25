import type {FastifyPluginAsync} from 'fastify';
import {filesTools, executeFilesTool} from '@/server/tools/files-tools';
import {makeToolGroupRoutes} from '../tool-group';

export const filesRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(filesTools, executeFilesTool));
};

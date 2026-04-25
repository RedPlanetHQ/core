import type {FastifyPluginAsync} from 'fastify';
import {utilsTools, executeUtilsTool} from '@/server/tools/utils-tools';
import {makeToolGroupRoutes} from '../tool-group';

export const utilsRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(utilsTools, executeUtilsTool));
};

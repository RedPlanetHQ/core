import type {FastifyPluginAsync} from 'fastify';
import {browserTools, executeBrowserTool} from '@/server/tools/browser-tools';
import {makeToolGroupRoutes} from '../tool-group';
import {browserCdpRoute} from './cdp';
import {browserLaunchRoute} from './launch';

export const browserRoutes: FastifyPluginAsync = async (app) => {
	await app.register(makeToolGroupRoutes(browserTools, executeBrowserTool));
	await app.register(browserCdpRoute);
	await app.register(browserLaunchRoute);
};

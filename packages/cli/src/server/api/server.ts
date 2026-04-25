import Fastify, {type FastifyInstance} from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import {makeAuthHook} from './auth';
import {opsRoutes} from './ops';
import {codingRoutes} from './coding';
import {browserRoutes} from './browser';
import {execRoutes} from './exec';
import {filesRoutes} from './files';
import {utilsRoutes} from './utils';
import {isSlotEnabled} from './manifest-builder';
import {getPreferences} from '@/config/preferences';

export interface ApiServerOptions {
	port: number;
	host?: string;
	log?: (message: string) => void;
}

export async function buildServer(opts: ApiServerOptions): Promise<FastifyInstance> {
	const log = opts.log ?? (() => {});
	const app = Fastify({
		logger: false,
		bodyLimit: 50 * 1024 * 1024, // 50 MB — browser_screenshot base64 can be large
		trustProxy: true,
	});

	await app.register(fastifyWebsocket);

	// Auth for every route except /healthz/public.
	app.addHook('onRequest', makeAuthHook(['/healthz/public']));

	// Ops routes are always on (manifest / healthz / verify).
	await app.register(opsRoutes);

	// Group routes gated by slot config — a disabled slot hides both the
	// manifest entries and the HTTP routes so clients can't dodge the toggle.
	const slots = getPreferences().gateway?.slots;
	if (isSlotEnabled(slots, 'coding')) {
		await app.register(codingRoutes, {prefix: '/api/coding'});
	}
	if (isSlotEnabled(slots, 'browser')) {
		await app.register(browserRoutes, {prefix: '/api/browser'});
	}
	if (isSlotEnabled(slots, 'exec')) {
		await app.register(execRoutes, {prefix: '/api/exec'});
	}
	if (isSlotEnabled(slots, 'files')) {
		await app.register(filesRoutes, {prefix: '/api/files'});
	}
	// utils has no slot — it's always enabled (e.g. `sleep`).
	await app.register(utilsRoutes, {prefix: '/api/utils'});

	app.setErrorHandler((err: Error & {statusCode?: number; code?: string}, _req, reply) => {
		log(`api error: ${err.message}`);
		if (reply.sent) return;
		const status = err.statusCode ?? 500;
		reply.code(status).send({
			ok: false,
			error: {code: err.code ?? 'INTERNAL', message: err.message},
		});
	});

	return app;
}

export async function startServer(opts: ApiServerOptions): Promise<FastifyInstance> {
	const app = await buildServer(opts);
	await app.listen({port: opts.port, host: opts.host ?? '0.0.0.0'});
	opts.log?.(`gateway HTTP listening on :${opts.port}`);
	return app;
}

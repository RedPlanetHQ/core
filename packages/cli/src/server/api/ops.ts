import type {FastifyPluginAsync} from 'fastify';
import {hostname, platform} from 'node:os';
import type {GatewayConfig} from '@/types/config';
import {buildManifest} from './manifest-builder';
import {getPreferences} from '@/config/preferences';

const startedAt = Date.now();

export const opsRoutes: FastifyPluginAsync = async (app) => {
	app.get('/manifest', async (_req, reply) => {
		const {manifest, etag} = buildManifest();
		reply.header('etag', etag);
		return manifest;
	});

	app.get('/healthz', async () => {
		const {etag} = buildManifest();
		return {
			status: 'ok' as const,
			manifestEtag: etag,
			uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
		};
	});

	app.get('/healthz/public', async () => {
		return {status: 'ok' as const};
	});

	app.get('/verify', async () => {
		const gw: Partial<GatewayConfig> = getPreferences().gateway ?? {};
		return {
			ok: true,
			gatewayId: gw.id ?? null,
			hostname: hostname(),
			platform: platform(),
		};
	});
};

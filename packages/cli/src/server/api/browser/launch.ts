import type {FastifyPluginAsync} from 'fastify';
import {getOrLaunchSession} from '@/utils/browser-manager';
import {gatewayLog} from '@/server/gateway-log';

/**
 * Lazy-launch (or attach to) a configured browser session by name.
 *
 *   POST /api/browser/launch
 *   body: { session }
 *   → 200 { ok: true } on success
 *   → 404 / 500 on failure with `error`
 *
 * Always launches headless — the live view is delivered via CDP screencast
 * (`/api/browser/cdp/<session>`), so no visible window is needed and remote
 * gateways (Docker / Railway) work the same way as laptop ones. Idempotent —
 * `getOrLaunchSession` reuses the cached `BrowserSession` if it's already
 * running.
 */
export const browserLaunchRoute: FastifyPluginAsync = async (app) => {
	app.post<{
		Body: {session?: string};
	}>('/launch', async (req, reply) => {
		const body = (req.body ?? {}) as {session?: string};
		if (!body.session) {
			reply.code(400);
			return {ok: false, error: '`session` is required'};
		}
		gatewayLog(`browser launch: session=${body.session}`);
		const result = await getOrLaunchSession(body.session, false);
		if (result.error) {
			gatewayLog(`browser launch FAILED: ${result.error}`);
			reply.code(500);
			return {ok: false, error: result.error};
		}
		return {
			ok: true,
			session: {
				name: result.session.sessionName,
				profile: result.session.profile,
				cdpReady: Boolean(result.session.cdpWsEndpoint),
			},
		};
	});
};

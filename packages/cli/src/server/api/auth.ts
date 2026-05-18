import {createHash, createHmac, timingSafeEqual, randomBytes} from 'node:crypto';
import type {FastifyRequest, FastifyReply} from 'fastify';
import {getPreferences} from '@/config/preferences';

export function hashKey(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

export function generateSecurityKey(): string {
	return `gwk_${randomBytes(32).toString('base64url')}`;
}

/**
 * Verify a raw Bearer token against the stored sha256(securityKey) hash.
 * Constant-time comparison.
 */
export function verifySecurityKey(rawToken: string | undefined): boolean {
	if (!rawToken) return false;
	const expected = getPreferences().gateway?.securityKeyHash;
	if (!expected) return false;
	const got = hashKey(rawToken);
	const a = Buffer.from(got, 'hex');
	const b = Buffer.from(expected, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Extract the bearer token from an Authorization header, or null. */
export function extractBearer(header: string | undefined): string | null {
	if (!header?.startsWith('Bearer ')) return null;
	return header.slice('Bearer '.length).trim();
}

/**
 * Verify a short-lived xterm WS ticket. Ticket format:
 *
 *   base64url(JSON({sid, exp})) "." base64url(HMAC-SHA256(hmacKey, payload))
 *
 * `hmacKey` is the gateway's stored `securityKeyHash` (hex string of
 * sha256(rawKey)) — the webapp recomputes the same value from the raw key it
 * decrypted from its DB, so both sides arrive at the same MAC key without
 * having to share a separate secret.
 *
 * The ticket is bound to a single PTY: the caller must pass the `session_id`
 * the WS is attaching to so we can reject tickets minted for a different
 * session. Expiry is checked with a small (+5s) skew tolerance.
 */
export function verifyTicket(
	rawTicket: string | undefined,
	sessionId: string,
): boolean {
	if (!rawTicket || !sessionId) return false;
	const hmacKey = getPreferences().gateway?.securityKeyHash;
	if (!hmacKey) return false;

	const dot = rawTicket.indexOf('.');
	if (dot <= 0 || dot === rawTicket.length - 1) return false;
	const payloadB64 = rawTicket.slice(0, dot);
	const sigB64 = rawTicket.slice(dot + 1);

	const expected = createHmac('sha256', hmacKey).update(payloadB64).digest();
	let provided: Buffer;
	try {
		provided = Buffer.from(sigB64, 'base64url');
	} catch {
		return false;
	}
	if (provided.length !== expected.length) return false;
	if (!timingSafeEqual(provided, expected)) return false;

	let payload: {sid?: unknown; exp?: unknown};
	try {
		payload = JSON.parse(
			Buffer.from(payloadB64, 'base64url').toString('utf8'),
		) as typeof payload;
	} catch {
		return false;
	}
	if (typeof payload.sid !== 'string' || typeof payload.exp !== 'number') {
		return false;
	}
	if (payload.sid !== sessionId) return false;
	// 5s skew tolerance for clock drift between webapp and gateway hosts.
	if (payload.exp + 5_000 < Date.now()) return false;

	return true;
}

/**
 * Paths where `?ticket=…` is accepted in lieu of `Authorization: Bearer`.
 * Kept tiny and explicit — the ticket auth path is only for browser-direct
 * WebSocket attaches; every other route still requires the full security key.
 */
const TICKET_PATHS: ReadonlySet<string> = new Set([
	'/api/coding/coding_xterm_session',
]);

/**
 * Fastify onRequest hook. Skips authentication for paths in `skip`
 * (e.g. `/healthz/public`). On `TICKET_PATHS` requests may authenticate
 * via `?ticket=…&session_id=…`; every other request must present a valid
 * Bearer securityKey — there is no loopback bypass.
 */
export function makeAuthHook(skip: string[] = ['/healthz/public']) {
	return async function authHook(req: FastifyRequest, reply: FastifyReply) {
		if (skip.some((s) => req.url === s || req.url.startsWith(s + '?'))) return;

		// Ticket auth for the browser-direct xterm WS. A request that targets
		// a TICKET_PATH and supplies `?ticket=…` is verified via HMAC instead
		// of Bearer — the browser never sees the gateway's raw securityKey.
		const pathOnly = req.url.split('?')[0] ?? req.url;
		if (TICKET_PATHS.has(pathOnly)) {
			const q = req.query as {ticket?: string; session_id?: string} | undefined;
			if (q?.ticket) {
				if (verifyTicket(q.ticket, q.session_id ?? '')) return;
				reply.code(401).send({
					ok: false,
					error: {code: 'UNAUTHORIZED', message: 'invalid or expired ticket'},
				});
				return;
			}
			// no ticket present → fall through to Bearer (legacy webapp proxy path)
		}

		const token = extractBearer(req.headers['authorization']);
		if (!verifySecurityKey(token ?? undefined)) {
			reply.code(401).send({ok: false, error: {code: 'UNAUTHORIZED', message: 'invalid or missing security key'}});
		}
	};
}

import {createHash, timingSafeEqual, randomBytes} from 'node:crypto';
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
 * Fastify onRequest hook. Skips authentication for paths in `skip`
 * (e.g. `/healthz/public`). Every other request must present a valid Bearer
 * securityKey — there is no loopback bypass.
 */
export function makeAuthHook(skip: string[] = ['/healthz/public']) {
	return async function authHook(req: FastifyRequest, reply: FastifyReply) {
		if (skip.some((s) => req.url === s || req.url.startsWith(s + '?'))) return;
		const token = extractBearer(req.headers['authorization']);
		if (!verifySecurityKey(token ?? undefined)) {
			reply.code(401).send({ok: false, error: {code: 'UNAUTHORIZED', message: 'invalid or missing security key'}});
		}
	};
}

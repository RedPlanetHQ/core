import jwt from 'jsonwebtoken';

/**
 * Generate a Ghost Admin API JWT token from an Admin API key.
 * The key format is "id:secret" where secret is hex-encoded.
 */
export function generateGhostToken(adminApiKey: string): string {
  const [id, secret] = adminApiKey.split(':');
  return jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: '/admin/',
  });
}

export function getAuthHeaders(adminApiKey: string): Record<string, string> {
  return { Authorization: `Ghost ${generateGhostToken(adminApiKey)}` };
}

import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface VerificationPayload {
  identifier: string;
  source: 'whatsapp' | 'email';
}

export function generateVerificationToken(payload: VerificationPayload): string {
  return jwt.sign(
    payload,
    env.ENCRYPTION_KEY,
    { expiresIn: `${parseInt(env.VERIFICATION_LINK_EXPIRY_MINUTES)}m` }
  );
}

export function verifyToken(token: string): VerificationPayload {
  return jwt.verify(token, env.ENCRYPTION_KEY) as VerificationPayload;
}

export function getVerificationExpiry(): Date {
  const minutes = parseInt(env.VERIFICATION_LINK_EXPIRY_MINUTES);
  return new Date(Date.now() + minutes * 60 * 1000);
}

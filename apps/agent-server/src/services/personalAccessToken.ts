import { type PersonalAccessToken } from '@core/database';
import { customAlphabet } from 'nanoid';
import nodeCrypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.server';
import { env } from '../config/env';

const tokenValueLength = 40;
const tokenGenerator = customAlphabet(
  '123456789abcdefghijkmnopqrstuvwxyz',
  tokenValueLength,
);

const tokenPrefix = 'rc_pat_';

const EncryptedSecretValueSchema = z.object({
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

type CreatePersonalAccessTokenOptions = {
  name: string;
  userId: string;
};

/** Get or create a PersonalAccessToken for the given name and userId. */
export async function getOrCreatePersonalAccessToken({
  name,
  userId,
}: CreatePersonalAccessTokenOptions) {
  // Try to find an existing, non-revoked token
  const existing = await prisma.personalAccessToken.findFirst({
    where: {
      name,
      userId,
      revokedAt: null,
    },
  });

  if (existing) {
    // Token exists, decrypt and return it
    const token = decryptPersonalAccessToken(existing);
    return {
      id: existing.id,
      name: existing.name,
      userId: existing.userId,
      obfuscatedToken: existing.obfuscatedToken,
      token, // Return decrypted token
    };
  }

  // Create a new token
  const token = createToken();
  const encryptedToken = encryptToken(token);

  const personalAccessToken = await prisma.personalAccessToken.create({
    data: {
      name,
      userId,
      encryptedToken,
      obfuscatedToken: obfuscateToken(token),
      hashedToken: hashToken(token),
    },
  });

  return {
    id: personalAccessToken.id,
    name,
    userId,
    token,
    obfuscatedToken: personalAccessToken.obfuscatedToken,
  };
}

export async function findTokenByUserAndName(userId: string, name: string) {
  return await prisma.personalAccessToken.findFirst({
    where: {
      userId,
      name,
      revokedAt: null,
    },
  });
}

export function decryptToken(pat: PersonalAccessToken): string {
  return decryptPersonalAccessToken(pat);
}

/** Creates a PersonalAccessToken that starts with rc_pat_ */
function createToken() {
  return `${tokenPrefix}${tokenGenerator()}`;
}

/** Obfuscates all but the first and last 4 characters of the token */
function obfuscateToken(token: string) {
  const withoutPrefix = token.replace(tokenPrefix, '');
  const obfuscated = `${withoutPrefix.slice(0, 4)}${'•'.repeat(18)}${withoutPrefix.slice(-4)}`;
  return `${tokenPrefix}${obfuscated}`;
}

function encryptToken(value: string) {
  const nonce = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv(
    'aes-256-gcm',
    env.ENCRYPTION_KEY,
    nonce,
  );

  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag().toString('hex');

  return {
    nonce: nonce.toString('hex'),
    ciphertext: encrypted,
    tag,
  };
}

function decryptPersonalAccessToken(personalAccessToken: PersonalAccessToken) {
  const encryptedData = EncryptedSecretValueSchema.safeParse(
    personalAccessToken.encryptedToken,
  );
  if (!encryptedData.success) {
    throw new Error(
      `Unable to parse encrypted PersonalAccessToken with id: ${personalAccessToken.id}: ${encryptedData.error.message}`,
    );
  }

  const decryptedToken = decryptTokenValue(
    encryptedData.data.nonce,
    encryptedData.data.ciphertext,
    encryptedData.data.tag,
  );
  return decryptedToken;
}

function decryptTokenValue(nonce: string, ciphertext: string, tag: string): string {
  const decipher = nodeCrypto.createDecipheriv(
    'aes-256-gcm',
    env.ENCRYPTION_KEY,
    Buffer.from(nonce, 'hex'),
  );

  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

function hashToken(token: string): string {
  const hash = nodeCrypto.createHash('sha256');
  hash.update(token);
  return hash.digest('hex');
}

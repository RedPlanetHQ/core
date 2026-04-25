import { prisma } from "~/db.server";
import {
  encryptSecret,
  decryptSecret,
  EncryptedSecretSchema,
} from "~/lib/encryption.server";

/**
 * Encrypt a gateway's raw securityKey and persist it on the Gateway row.
 * Called once during registration — the raw key is never stored anywhere else.
 */
export async function storeSecurityKey(
  gatewayId: string,
  securityKey: string,
): Promise<void> {
  const encrypted = encryptSecret(securityKey);
  await prisma.gateway.update({
    where: { id: gatewayId },
    data: { encryptedSecurityKey: encrypted as unknown as object },
  });
}

/**
 * Read and decrypt a gateway's securityKey. Used whenever the backend needs
 * to call the gateway (`Authorization: Bearer <key>`).
 */
export async function readSecurityKey(gatewayId: string): Promise<string> {
  const row = await prisma.gateway.findUniqueOrThrow({
    where: { id: gatewayId },
    select: { encryptedSecurityKey: true },
  });
  const parsed = EncryptedSecretSchema.parse(row.encryptedSecurityKey);
  return decryptSecret(parsed);
}

/**
 * Encrypt an arbitrary securityKey without persisting it yet. Useful when
 * the Gateway row doesn't exist — the caller does
 *   `prisma.gateway.create({ data: { ...encryptedSecurityKey: ciphertext(key) } })`
 * atomically in one insert.
 */
export function ciphertext(securityKey: string) {
  return encryptSecret(securityKey) as unknown as object;
}

import nodeCrypto from "node:crypto";
import { z } from "zod";
import { env } from "~/env.server";

export const EncryptedSecretSchema = z.object({
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

export function encryptSecret(value: string): EncryptedSecret {
  const nonce = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv(
    "aes-256-gcm",
    env.ENCRYPTION_KEY,
    nonce,
  );

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag().toString("hex");

  return {
    nonce: nonce.toString("hex"),
    ciphertext: encrypted,
    tag,
  };
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  const decipher = nodeCrypto.createDecipheriv(
    "aes-256-gcm",
    env.ENCRYPTION_KEY,
    Buffer.from(encrypted.nonce, "hex"),
  );

  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

  let decrypted = decipher.update(encrypted.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

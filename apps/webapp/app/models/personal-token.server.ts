import { type PersonalAccessToken } from "@core/database";
import { prisma } from "~/db.server";
import nodeCrypto from "node:crypto";
import { z } from "zod";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";

export type PersonalAccessTokenAuthenticationResult = {
  userId: string;
  workspaceId: string;
};

const EncryptedSecretValueSchema = z.object({
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

export async function findUserByToken(
  token: string,
): Promise<PersonalAccessTokenAuthenticationResult | null> {
  const hashedToken = hashToken(token);

  const personalAccessToken = await prisma.personalAccessToken.findFirst({
    where: {
      hashedToken,
      revokedAt: null,
    },
  });

  if (!personalAccessToken) {
    // The token may have been revoked or is entirely invalid
    return null;
  }

  await prisma.personalAccessToken.update({
    where: {
      id: personalAccessToken.id,
    },
    data: {
      lastAccessedAt: new Date(),
    },
  });

  const decryptedToken = decryptPersonalAccessToken(personalAccessToken);

  if (decryptedToken !== token) {
    logger.error(
      `PersonalAccessToken with id: ${personalAccessToken.id} was found in the database with hash ${hashedToken}, but the decrypted token did not match the provided token.`,
    );
    return null;
  }

  let workspaceId = personalAccessToken.workspaceId;

  if (!workspaceId) {
    const workspace = await prisma.userWorkspace.findFirst({
      where: {
        userId: personalAccessToken.userId
      }
    })

    // Not possible to create a pat without workspace
     workspaceId = workspace?.id || ""
  }

  return {
    userId: personalAccessToken.userId,
    workspaceId,
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

  const decryptedToken = decryptToken(
    encryptedData.data.nonce,
    encryptedData.data.ciphertext,
    encryptedData.data.tag,
  );
  return decryptedToken;
}

function decryptToken(nonce: string, ciphertext: string, tag: string): string {
  const decipher = nodeCrypto.createDecipheriv(
    "aes-256-gcm",
    env.ENCRYPTION_KEY,
    Buffer.from(nonce, "hex"),
  );

  decipher.setAuthTag(Buffer.from(tag, "hex"));

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function hashToken(token: string): string {
  const hash = nodeCrypto.createHash("sha256");
  hash.update(token);
  return hash.digest("hex");
}

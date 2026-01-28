import { type PersonalAccessToken } from "@core/database";
import { customAlphabet, nanoid } from "nanoid";
import nodeCrypto from "node:crypto";
import { z } from "zod";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { logger } from "./logger.service";

const tokenValueLength = 40;
//lowercase only, removed 0 and l to avoid confusion
const tokenGenerator = customAlphabet(
  "123456789abcdefghijkmnopqrstuvwxyz",
  tokenValueLength,
);

type CreatePersonalAccessTokenOptions = {
  name: string;
  userId: string;
  workspaceId: string;
};

export const GetPersonalAccessTokenRequestSchema = z.object({
  authorizationCode: z.string(),
});
export type GetPersonalAccessTokenRequest = z.infer<
  typeof GetPersonalAccessTokenRequestSchema
>;

export const GetPersonalAccessTokenResponseSchema = z.object({
  token: z
    .object({
      token: z.string(),
      obfuscatedToken: z.string(),
    })
    .nullable(),
});
export type GetPersonalAccessTokenResponse = z.infer<
  typeof GetPersonalAccessTokenResponseSchema
>;

/** Returns obfuscated access tokens that aren't revoked */
export async function getValidPersonalAccessTokens(userId: string) {
  const personalAccessTokens = await prisma.personalAccessToken.findMany({
    select: {
      id: true,
      name: true,
      obfuscatedToken: true,
      createdAt: true,
      lastAccessedAt: true,
    },
    where: {
      userId,
      revokedAt: null,
      name: {
        notIn: ["cli", "whatsapp"],
      },
    },
  });

  return personalAccessTokens.map((pat) => ({
    id: pat.id,
    name: pat.name,
    obfuscatedToken: pat.obfuscatedToken,
    createdAt: pat.createdAt,
    lastAccessedAt: pat.lastAccessedAt,
  }));
}

export type ObfuscatedPersonalAccessToken = Awaited<
  ReturnType<typeof getValidPersonalAccessTokens>
>[number];

/** Gets a PersonalAccessToken from an Auth Code, this only works within 10 mins of the auth code being created */
export async function getPersonalAccessTokenFromAuthorizationCode(
  authorizationCode: string,
) {
  //only allow authorization codes that were created less than 10 mins ago
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const code = await prisma.authorizationCode.findUnique({
    select: {
      personalAccessToken: true,
    },
    where: {
      code: authorizationCode,
      createdAt: {
        gte: tenMinutesAgo,
      },
    },
  });
  if (!code) {
    throw new Error("Invalid authorization code, or code expired");
  }

  //there's no PersonalAccessToken associated with this code
  if (!code.personalAccessToken) {
    return {
      token: null,
    };
  }

  const decryptedToken = decryptPersonalAccessToken(code.personalAccessToken);
  return {
    token: {
      token: decryptedToken,
      obfuscatedToken: code.personalAccessToken.obfuscatedToken,
    },
  };
}

export async function revokePersonalAccessToken(tokenId: string) {
  await prisma.personalAccessToken.update({
    where: {
      id: tokenId,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export type PersonalAccessTokenAuthenticationResult = {
  userId: string;
  workspaceId?: string;
};

const EncryptedSecretValueSchema = z.object({
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

const AuthorizationHeaderSchema = z.string().regex(/^Bearer .+$/);

export async function authenticateApiRequestWithPersonalAccessToken(
  request: Request,
): Promise<PersonalAccessTokenAuthenticationResult | undefined> {
  const token = getPersonalAccessTokenFromRequest(request);
  if (!token) {
    return;
  }

  return authenticatePersonalAccessToken(token);
}

function getPersonalAccessTokenFromRequest(request: Request) {
  const rawAuthorization = request.headers.get("Authorization");

  const authorization = AuthorizationHeaderSchema.safeParse(rawAuthorization);
  if (!authorization.success) {
    return;
  }

  const personalAccessToken = authorization.data.replace(/^Bearer /, "");
  return personalAccessToken;
}

export async function authenticatePersonalAccessToken(
  token: string,
): Promise<PersonalAccessTokenAuthenticationResult | undefined> {
  if (!token.startsWith(tokenPrefix)) {
    logger.warn(`PAT doesn't start with ${tokenPrefix}`);
    return;
  }

  const hashedToken = hashToken(token);

  const personalAccessToken = await prisma.personalAccessToken.findFirst({
    where: {
      hashedToken,
      revokedAt: null,
    },
  });

  if (!personalAccessToken) {
    // The token may have been revoked or is entirely invalid
    return;
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
    return;
  }

  let workspaceId: string | null = personalAccessToken.workspaceId;

  if (!workspaceId) {
    const workspace = await prisma.userWorkspace.findFirst({
      where: {
        userId: personalAccessToken.userId
      }
    })

    workspaceId = workspace?.id ?? null
  }

  return {
    userId: personalAccessToken.userId,
    workspaceId: personalAccessToken.workspaceId ?? undefined,
  };
}

export function isPersonalAccessToken(token: string) {
  return token.startsWith(tokenPrefix);
}

export const CreateAuthorizationCodeResponseSchema = z.object({
  url: z.string().url(),
  authorizationCode: z.string(),
});

export type CreateAuthorizationCodeResponse = z.infer<
  typeof CreateAuthorizationCodeResponseSchema
>;

export function createAuthorizationCode() {
  return prisma.authorizationCode.create({
    data: {
      code: nanoid(64),
    },
  });
}

/** Creates a PersonalAccessToken from an Auth Code, and return the token. We only ever return the unencrypted token once. */
export async function createPersonalAccessTokenFromAuthorizationCode(
  authorizationCode: string,
  userId: string,
  workspaceId: string,
  name?: string,
) {
  //only allow authorization codes that were created less than 10 mins ago
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const code = await prisma.authorizationCode.findUnique({
    where: {
      code: authorizationCode,
      personalAccessTokenId: null,
      createdAt: {
        gte: tenMinutesAgo,
      },
    },
  });

  if (!code) {
    throw new Error(
      "Invalid authorization code, code already used, or code expired",
    );
  }

  const existingCliPersonalAccessToken =
    await prisma.personalAccessToken.findFirst({
      where: {
        userId,
        name: name ?? "cli",
      },
    });

  //we only allow you to have one CLI PAT at a time, so return this
  if (existingCliPersonalAccessToken) {
    //associate this authorization code with the existing personal access token
    await prisma.authorizationCode.update({
      where: {
        code: authorizationCode,
      },
      data: {
        personalAccessTokenId: existingCliPersonalAccessToken.id,
      },
    });

    if (existingCliPersonalAccessToken.revokedAt) {
      // re-activate revoked CLI PAT so we can use it again
      await prisma.personalAccessToken.update({
        where: {
          id: existingCliPersonalAccessToken.id,
        },
        data: {
          revokedAt: null,
        },
      });
    }

    //we don't return the decrypted token
    return {
      id: existingCliPersonalAccessToken.id,
      name: existingCliPersonalAccessToken.name,
      userId: existingCliPersonalAccessToken.userId,
      obfuscateToken: existingCliPersonalAccessToken.obfuscatedToken,
    };
  }

  const token = await createPersonalAccessToken({
    name: "cli",
    userId,
    workspaceId,
  });

  await prisma.authorizationCode.update({
    where: {
      code: authorizationCode,
    },
    data: {
      personalAccessTokenId: token.id,
    },
  });

  return token;
}

/** Get or create a PersonalAccessToken for the given name and userId.
 * If one exists (not revoked), return it (without the unencrypted token).
 * If not, create a new one and return it (with the unencrypted token).
 * We only ever return the unencrypted token once, on creation.
 */
export async function getOrCreatePersonalAccessToken({
  name,
  userId,
  workspaceId
}: CreatePersonalAccessTokenOptions) {
  // Try to find an existing, non-revoked token
  const existing = await prisma.personalAccessToken.findFirst({
    where: {
      name,
      userId,
      workspaceId,
      revokedAt: null,
    },
  });

  if (existing) {
    // Do not return the unencrypted token if it already exists
    return {
      id: existing.id,
      name: existing.name,
      userId: existing.userId,
      workspaceId: existing.workspaceId,
      obfuscatedToken: existing.obfuscatedToken,
      // token is not returned
    };
  }

  // Create a new token
  const token = createToken();
  const encryptedToken = encryptToken(token);

  const personalAccessToken = await prisma.personalAccessToken.create({
    data: {
      name,
      userId,
      workspaceId,
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

export async function deletePersonalAccessToken(tokenId: string) {
  return await prisma.personalAccessToken.delete({
    where: {
      id: tokenId,
    },
  });
}

/** Created a new PersonalAccessToken, and return the token. We only ever return the unencrypted token once. */
export async function createPersonalAccessToken({
  name,
  userId,
  workspaceId
}: CreatePersonalAccessTokenOptions) {
  const token = createToken();
  const encryptedToken = encryptToken(token);

  const personalAccessToken = await prisma.personalAccessToken.create({
    data: {
      name,
      userId,
      workspaceId,
      encryptedToken,
      obfuscatedToken: obfuscateToken(token),
      hashedToken: hashToken(token),
    },
  });

  return {
    id: personalAccessToken.id,
    name,
    userId,
    workspaceId,
    token,
    obfuscatedToken: personalAccessToken.obfuscatedToken,
  };
}

export type CreatedPersonalAccessToken = Awaited<
  ReturnType<typeof createPersonalAccessToken>
>;

const tokenPrefix = "rc_pat_";

/** Creates a PersonalAccessToken that starts with tr_pat_  */
function createToken() {
  return `${tokenPrefix}${tokenGenerator()}`;
}

/** Obfuscates all but the first and last 4 characters of the token, so it looks like rc_pat_bhbd•••••••••••••••••••fd4a */
function obfuscateToken(token: string) {
  const withoutPrefix = token.replace(tokenPrefix, "");
  const obfuscated = `${withoutPrefix.slice(0, 4)}${"•".repeat(18)}${withoutPrefix.slice(-4)}`;
  return `${tokenPrefix}${obfuscated}`;
}

function encryptToken(value: string) {
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

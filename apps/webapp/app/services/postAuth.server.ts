import type { User } from "@core/database";
import { createWorkspace } from "~/models/workspace.server";
import { prisma } from "~/db.server";
import { logger } from "./logger.service";
import { env } from "~/env.server";

// Integration slugs for auto-creation
const GMAIL_INTEGRATION_SLUG = "gmail";
const CALENDAR_INTEGRATION_SLUG = "google-calendar";

// Required scopes for each integration
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];
const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"];

function hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => grantedScopes.includes(scope));
}

interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

interface GoogleUserInfo {
  email: string;
  id: string;
  name?: string;
  picture?: string;
  locale?: string;
}

interface GoogleCalendarSettings {
  value: string;
}

async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      logger.error("Failed to fetch Google user info", {
        status: response.status,
      });
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error("Error fetching Google user info", { error });
    return null;
  }
}

async function fetchGoogleTimezone(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/settings/timezone",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      logger.error("Failed to fetch Google timezone", {
        status: response.status,
      });
      return null;
    }

    const data: GoogleCalendarSettings = await response.json();
    return data.value;
  } catch (error) {
    logger.error("Error fetching Google timezone", { error });
    return null;
  }
}

async function createGoogleIntegrationAccount({
  integrationDefinitionId,
  userId,
  workspaceId,
  tokens,
  clientId,
  clientSecret,
  userInfo,
}: {
  integrationDefinitionId: string;
  userId: string;
  workspaceId: string;
  tokens: GoogleTokens;
  clientId: string;
  clientSecret: string;
  userInfo: GoogleUserInfo;
}) {
  const integrationConfiguration = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    token_type: "Bearer",
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    scope: tokens.scopes.join(" "),
    userEmail: userInfo.email,
    userId: userInfo.id,
    redirect_uri: `${env.APP_ORIGIN}/api/v1/oauth/callback`,
  };

  return prisma.integrationAccount.upsert({
    where: {
      accountId_integrationDefinitionId_workspaceId: {
        accountId: userInfo.email,
        integrationDefinitionId,
        workspaceId,
      },
    },
    update: {
      integrationConfiguration,
      isActive: true,
      deleted: null,
    },
    create: {
      accountId: userInfo.email,
      integrationDefinitionId,
      integratedById: userId,
      integrationConfiguration,
      settings: {},
      isActive: true,
      workspaceId,
    },
  });
}

async function autoCreateIntegrations({
  userId,
  workspaceId,
  tokens,
  clientId,
  clientSecret,
}: {
  userId: string;
  workspaceId: string;
  tokens: GoogleTokens;
  clientId: string;
  clientSecret: string;
}) {
  try {
    // Fetch user info from Google
    const userInfo = await fetchGoogleUserInfo(tokens.accessToken);
    if (!userInfo) {
      logger.error("Could not fetch user info for integration creation");
      return;
    }

    // Get Gmail integration definition
    const gmailDefinition = await prisma.integrationDefinitionV2.findFirst({
      where: { slug: GMAIL_INTEGRATION_SLUG, deleted: null },
    });

    // Get Google Calendar integration definition
    const calendarDefinition = await prisma.integrationDefinitionV2.findFirst({
      where: { slug: CALENDAR_INTEGRATION_SLUG, deleted: null },
    });

    // Create Gmail integration account if definition exists and user granted required scopes
    if (gmailDefinition) {
      if (hasRequiredScopes(tokens.scopes, GMAIL_SCOPES)) {
        try {
          await createGoogleIntegrationAccount({
            integrationDefinitionId: gmailDefinition.id,
            userId,
            workspaceId,
            tokens,
            clientId,
            clientSecret,
            userInfo,
          });
          logger.info(`Auto-created Gmail integration for user ${userId}`);
        } catch (error) {
          logger.error("Error creating Gmail integration account", { error });
        }
      } else {
        logger.info(
          `Skipping Gmail integration - user did not grant required scopes`,
        );
      }
    } else {
      logger.warn("Gmail integration definition not found");
    }

    // Create Google Calendar integration account if definition exists and user granted required scopes
    if (calendarDefinition) {
      if (hasRequiredScopes(tokens.scopes, CALENDAR_SCOPES)) {
        try {
          await createGoogleIntegrationAccount({
            integrationDefinitionId: calendarDefinition.id,
            userId,
            workspaceId,
            tokens,
            clientId,
            clientSecret,
            userInfo,
          });
          logger.info(
            `Auto-created Google Calendar integration for user ${userId}`,
          );
        } catch (error) {
          logger.error("Error creating Google Calendar integration account", {
            error,
          });
        }
      } else {
        logger.info(
          `Skipping Google Calendar integration - user did not grant required scopes`,
        );
      }
    } else {
      logger.warn("Google Calendar integration definition not found");
    }
  } catch (error) {
    logger.error("Error in autoCreateIntegrations", { error });
  }
}

async function updateUserTimezone({
  userId,
  accessToken,
}: {
  userId: string;
  accessToken: string;
}) {
  try {
    const timezone = await fetchGoogleTimezone(accessToken);

    if (timezone) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { metadata: true },
      });

      const currentMetadata = (user?.metadata as Record<string, unknown>) || {};

      await prisma.user.update({
        where: { id: userId },
        data: {
          metadata: {
            ...currentMetadata,
            timezone,
          },
        },
      });

      logger.info(`Updated timezone for user ${userId}: ${timezone}`);
    }
  } catch (error) {
    logger.error("Error updating user timezone", { error });
  }
}

export async function postAuthentication({
  user,
  loginMethod,
  isNewUser,
  tokens,
  clientId,
  clientSecret,
}: {
  user: User;
  loginMethod: User["authenticationMethod"];
  isNewUser: boolean;
  tokens?: GoogleTokens;
  clientId?: string;
  clientSecret?: string;
}) {
  if (user.name && isNewUser && loginMethod === "GOOGLE") {
    const workspace = await createWorkspace({
      name: user.name,
      userId: user.id,
      integrations: [],
    });

    // Auto-create Gmail and Calendar integrations if tokens are available
    if (tokens && clientId && clientSecret) {
      await autoCreateIntegrations({
        userId: user.id,
        workspaceId: workspace.id,
        tokens,
        clientId,
        clientSecret,
      });

      // Update user timezone from Google Calendar settings (only if calendar scope granted)
      if (hasRequiredScopes(tokens.scopes, CALENDAR_SCOPES)) {
        await updateUserTimezone({
          userId: user.id,
          accessToken: tokens.accessToken,
        });
      }
    }
  }
}

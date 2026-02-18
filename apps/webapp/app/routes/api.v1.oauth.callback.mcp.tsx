import { type LoaderFunctionArgs } from "@remix-run/node";
import { completeCustomMcpOAuth } from "@core/mcp-proxy";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { customMcpOAuthSession } from "./api.v1.oauth.custom-mcp";
import { prisma } from "~/db.server";
import { updateUser } from "~/models/user.server";

const MCP_CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback/mcp`;

type McpIntegration = {
  id: string;
  name: string;
  serverUrl: string;
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    clientId?: string;
    clientSecret?: string;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authorizationCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!authorizationCode || !state) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/home/integrations?success=false&error=${encodeURIComponent(
          "Missing authorization code or state"
        )}`,
      },
    });
  }

  const session = customMcpOAuthSession[state];
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/home/integrations?success=false&error=${encodeURIComponent(
          "Invalid or expired session"
        )}`,
      },
    });
  }

  const { userId, serverUrl, name, redirectURL, sessionData } = session;

  // Clean up session
  delete customMcpOAuthSession[state];

  try {
    const result = await completeCustomMcpOAuth({
      serverUrl,
      redirectUrl: MCP_CALLBACK_URL,
      authorizationCode,
      sessionData,
      clientName: "Core MCP Client",
    });

    // Get user and update metadata with OAuth tokens
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const metadata = (user.metadata as any) || {};
    const currentIntegrations = (metadata?.mcpIntegrations ||
      []) as McpIntegration[];

    // Create new integration with OAuth data
    const newIntegration: McpIntegration = {
      id: crypto.randomUUID(),
      name,
      serverUrl,
      oauth: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
      },
    };

    const updatedIntegrations = [...currentIntegrations, newIntegration];

    await updateUser({
      id: userId,
      metadata: {
        ...metadata,
        mcpIntegrations: updatedIntegrations,
      },
      onboardingComplete: user.onboardingComplete,
    });

    logger.info(`Custom MCP OAuth completed for ${name}`);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectURL}?success=true&integrationName=${encodeURIComponent(
          name
        )}`,
      },
    });
  } catch (error: any) {
    logger.error("Custom MCP OAuth callback error:", error);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectURL}?success=false&error=${encodeURIComponent(
          error.message || "OAuth callback failed"
        )}`,
      },
    });
  }
}

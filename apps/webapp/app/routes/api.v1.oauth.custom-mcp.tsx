import { json } from "@remix-run/node";
import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId } from "~/services/session.server";
import {
  getCustomMcpAuthorizationUrl,
  type CustomMcpOAuthSession,
} from "@core/mcp-proxy";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import { z } from "zod";

const MCP_CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback/mcp`;

// Session store for custom MCP OAuth flows
export const customMcpOAuthSession: Record<
  string,
  {
    userId: string;
    serverUrl: string;
    name: string;
    redirectURL: string;
    sessionData: CustomMcpOAuthSession;
  }
> = {};

const InitiateOAuthSchema = z.object({
  intent: z.literal("initiate"),
  name: z.string().min(1),
  serverUrl: z.string().url(),
  redirectURL: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "initiate") {
    const name = formData.get("name") as string;
    const serverUrl = formData.get("serverUrl") as string;
    const redirectURL =
      (formData.get("redirectURL") as string) ||
      `${env.APP_ORIGIN}/home/integrations`;

    try {
      // Validate inputs
      InitiateOAuthSchema.parse({ intent, name, serverUrl, redirectURL });

      const { authUrl, sessionData } = await getCustomMcpAuthorizationUrl({
        serverUrl,
        redirectUrl: MCP_CALLBACK_URL,
        clientName: "Core MCP Client",
      });

      // Generate a unique state for this session
      const state = crypto.randomUUID();

      // Store session data for callback
      customMcpOAuthSession[state] = {
        userId,
        serverUrl,
        name,
        redirectURL,
        sessionData,
      };

      // Append state to auth URL if not already present
      const authUrlObj = new URL(authUrl);
      if (!authUrlObj.searchParams.has("state")) {
        authUrlObj.searchParams.set("state", state);
      }

      logger.info(`Custom MCP OAuth initiated for ${name} at ${serverUrl}`);

      return json({
        success: true,
        redirectURL: authUrlObj.toString(),
        state,
      });
    } catch (error: any) {
      logger.error("Custom MCP OAuth initiation error:", error);
      return json(
        {
          success: false,
          error: error.message || "Failed to initiate OAuth",
        },
        { status: 400 }
      );
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

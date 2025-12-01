import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { oauthIntegrationService } from "~/services/oauthIntegration.server";
import { authenticateOAuthRequest } from "~/services/apiAuth.server";

/**
 * API endpoint for OAuth apps to get their connected integrations
 * GET /api/oauth/integrations
 * Authorization: Bearer <oauth_access_token>
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Authenticate OAuth request and verify integration scope
    const authResult = await authenticateOAuthRequest(request, ["integration"]);

    if (!authResult.success) {
      return json(
        {
          error: "unauthorized",
          error_description: authResult.error,
        },
        { status: 401 },
      );
    }

    // Get connected integrations for this client and user
    const integrations = await oauthIntegrationService.getConnectedIntegrations(
      {
        clientId: authResult.clientId!,
        userId: authResult.user!.id,
      },
    );

    return json({
      integrations,
      count: integrations.length,
    });
  } catch (error) {
    console.error("Error fetching OAuth integrations:", error);
    return json(
      {
        error: "server_error",
        error_description: "Internal server error",
      },
      { status: 500 },
    );
  }
};

// Method not allowed for non-GET requests
export const action = async () => {
  return json(
    {
      error: "method_not_allowed",
      error_description: "Only GET requests are allowed",
    },
    { status: 405 },
  );
};

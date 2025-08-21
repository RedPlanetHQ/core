import { type ActionFunctionArgs, json } from "@remix-run/node";
import {
  oauth2Service,
  OAuth2Errors,
  type OAuth2TokenRequest,
} from "~/services/oauth2.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json(
      {
        error: OAuth2Errors.INVALID_REQUEST,
        error_description: "Only POST method is allowed",
      },
      { status: 405 },
    );
  }

  try {
    const contentType = request.headers.get("content-type");
    let body: any;
    let tokenRequest: OAuth2TokenRequest;

    // Support both JSON and form-encoded data
    if (contentType?.includes("application/json")) {
      body = await request.json();
      tokenRequest = {
        grant_type: body.grant_type,
        code: body.code || undefined,
        redirect_uri: body.redirect_uri || undefined,
        client_id: body.client_id,
        client_secret: body.client_secret || undefined,
        code_verifier: body.code_verifier || undefined,
      };
    } else {
      // Fall back to form data for compatibility
      const formData = await request.formData();
      body = Object.fromEntries(formData);

      tokenRequest = {
        grant_type: formData.get("grant_type") as string,
        code: (formData.get("code") as string) || undefined,
        redirect_uri: (formData.get("redirect_uri") as string) || undefined,
        client_id: formData.get("client_id") as string,
        client_secret: (formData.get("client_secret") as string) || undefined,
        code_verifier: (formData.get("code_verifier") as string) || undefined,
      };
    }

    // Validate required parameters
    if (!tokenRequest.grant_type) {
      return json(
        {
          error: OAuth2Errors.INVALID_REQUEST,
          error_description: "Missing required parameters",
        },
        { status: 400 },
      );
    }

    // Handle authorization code grant
    if (tokenRequest.grant_type === "authorization_code") {
      if (!tokenRequest.code || !tokenRequest.redirect_uri) {
        return json(
          {
            error: OAuth2Errors.INVALID_REQUEST,
            error_description: "Missing code or redirect_uri",
          },
          { status: 400 },
        );
      }

      if (!tokenRequest.client_id || !tokenRequest.client_secret) {
        const clientData = await oauth2Service.getClientForCode(
          tokenRequest.code,
        );
        tokenRequest.client_id = clientData.client_id as string;
        tokenRequest.client_secret = clientData.client_secret;
      }

      // Validate client
      try {
        await oauth2Service.validateClient(
          tokenRequest.client_id,
          tokenRequest.client_secret,
        );
      } catch (error) {
        return json(
          {
            error: OAuth2Errors.INVALID_CLIENT,
            error_description: "Invalid client credentials",
          },
          { status: 401 },
        );
      }

      // Exchange code for tokens
      try {
        const tokens = await oauth2Service.exchangeCodeForTokens({
          code: tokenRequest.code,
          clientId: tokenRequest.client_id,
          redirectUri: tokenRequest.redirect_uri,
          codeVerifier: tokenRequest.code_verifier,
        });

        return json(tokens);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return json(
          {
            error: errorMessage,
            error_description: "Failed to exchange code for tokens",
          },
          { status: 400 },
        );
      }
    }

    // Handle refresh token grant
    if (tokenRequest.grant_type === "refresh_token") {
      const refreshToken = body.refresh_token;

      if (!refreshToken) {
        return json(
          {
            error: OAuth2Errors.INVALID_REQUEST,
            error_description: "Missing refresh_token",
          },
          { status: 400 },
        );
      }

      // Validate client
      try {
        await oauth2Service.validateClient(
          tokenRequest.client_id,
          tokenRequest.client_secret,
        );
      } catch (error) {
        return json(
          {
            error: OAuth2Errors.INVALID_CLIENT,
            error_description: "Invalid client credentials",
          },
          { status: 401 },
        );
      }

      // Refresh access token
      try {
        const tokens = await oauth2Service.refreshAccessToken(
          refreshToken,
          tokenRequest.client_id,
        );
        return json(tokens);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return json(
          {
            error: errorMessage,
            error_description: "Failed to refresh access token",
          },
          { status: 400 },
        );
      }
    }

    // Unsupported grant type
    return json(
      {
        error: OAuth2Errors.UNSUPPORTED_GRANT_TYPE,
        error_description: "Unsupported grant type",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("OAuth2 token endpoint error:", error);
    return json(
      {
        error: OAuth2Errors.SERVER_ERROR,
        error_description: "Internal server error",
      },
      { status: 500 },
    );
  }
};

// This endpoint only supports POST
export const loader = () => {
  return json(
    {
      error: OAuth2Errors.INVALID_REQUEST,
      error_description: "Only POST method is allowed",
    },
    { status: 405 },
  );
};

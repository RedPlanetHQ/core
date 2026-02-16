import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { OAuthBodySchema } from "~/services/oauth/oauth-utils.server";

import {
  getRedirectURL,
} from "~/services/oauth/oauth.server";

// This route handles the OAuth redirect URL generation, similar to the NestJS controller
const { action, loader } = createHybridActionApiRoute(
  {
    body: OAuthBodySchema,
    allowJWT: true,
    authorization: {
      action: "oauth",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    // Call the appropriate service based on MCP flag
    const redirectURL = await getRedirectURL(body, authentication.userId, authentication.workspaceId);

    return json(redirectURL);
  },
);

export { action, loader };

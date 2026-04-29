import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { getUserById } from "~/models/user.server";
import { getDocument, getPersonaForUser } from "~/services/document.server";
import { generateCollabToken } from "~/services/collab-token.server";

// This route handles the OAuth redirect URL generation, similar to the NestJS controller
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const user = await getUserById(authentication.userId);
    let personaLog;

    try {
      const documentId = await getPersonaForUser(
        authentication.workspaceId as string,
      );
      personaLog = await getDocument(
        documentId as string,
        authentication.workspaceId as string,
      );
    } catch (e) {}

    const metadata = user?.metadata as Record<string, unknown> | null;

    const workspaceId = authentication.workspaceId as string;
    const collabToken = workspaceId
      ? generateCollabToken(workspaceId, authentication.userId)
      : null;

    return json({
      id: authentication.userId,
      name: user?.name,
      persona: personaLog?.content,
      workspaceId,
      phoneNumber: user?.phoneNumber,
      email: user?.email,
      timezone: metadata?.timezone ?? null,
      metadata: user?.metadata,
      collabToken,
    });
  },
);

export { loader };

import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { getUserById } from "~/models/user.server";
import { getDocument, getPersonaForUser } from "~/services/document.server";

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
      const documentId = await getPersonaForUser(user?.Workspace?.id as string);
      personaLog = await getDocument(
        documentId as string,
        user?.Workspace?.id as string,
      );
    } catch (e) {}

    return json({
      id: authentication.userId,
      name: user?.name,
      persona: personaLog?.content,
      workspaceId: user?.Workspace?.id,
      phoneNumber: user?.phoneNumber,
      email: user?.email,
    });
  },
);

export { loader };

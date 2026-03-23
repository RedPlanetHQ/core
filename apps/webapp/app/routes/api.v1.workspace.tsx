import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    const workspace = await prisma.workspace.findFirst({
      where: { id: authentication.workspaceId },
      select: { id: true, name: true },
    });

    if (!workspace) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    return json({ id: workspace.id, name: workspace.name });
  },
);

export { loader };

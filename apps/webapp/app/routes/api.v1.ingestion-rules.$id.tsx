import { json } from "@remix-run/node";
import { z } from "zod";

import {
  createActionApiRoute,
  createLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";

const ParamsSchema = z.object({ id: z.string() });

const loader = createLoaderApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
    authorization: { action: "manage", resource: () => ({}) },
  },
  async ({ params, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "User workspace not found" }, { status: 404 });
    }
    const rule = await prisma.ingestionRule.findFirst({
      where: {
        id: params.id,
        workspaceId: authentication.workspaceId,
        deleted: null,
      },
      select: {
        id: true,
        name: true,
        text: true,
        source: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!rule) {
      return json(
        { success: false, message: "Rule not found" },
        { status: 404 },
      );
    }
    return json({ success: true, rule });
  },
);

const { action } = createActionApiRoute(
  {
    params: ParamsSchema,
    method: "DELETE",
    allowJWT: true,
    authorization: { action: "manage" },
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "User workspace not found" }, { status: 404 });
    }
    const rule = await prisma.ingestionRule.update({
      where: { id: params.id, workspaceId: authentication.workspaceId },
      data: { deleted: new Date() },
    });
    return json({
      success: true,
      message: "Rule deleted successfully",
      ruleId: rule.id,
    });
  },
);

export { action, loader };

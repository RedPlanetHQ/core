import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import {
  createActionApiRoute,
  createLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";

const IngestionRuleCreateSchema = z.object({
  name: z.string().optional(),
  text: z.string().min(1, "Rule text is required"),
  source: z.string().min(1, "Source is required"),
  isActive: z.boolean().default(true),
});

const IngestionRuleUpdateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  text: z.string().min(1, "Rule text is required").optional(),
  source: z.string().min(1, "Source is required").optional(),
  isActive: z.boolean().optional(),
});

const ruleSelect = {
  id: true,
  name: true,
  text: true,
  source: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const loader = createLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    searchParams: z.object({
      source: z.string().optional(),
      isActive: z.enum(["true", "false"]).optional(),
    }),
    findResource: async () => 1,
    authorization: { action: "manage", resource: () => ({}) },
  },
  async ({ authentication, searchParams }) => {
    if (!authentication.workspaceId) {
      return json({ error: "User workspace not found" }, { status: 404 });
    }
    const rules = await prisma.ingestionRule.findMany({
      where: {
        workspaceId: authentication.workspaceId,
        deleted: null,
        ...(searchParams.source && { source: searchParams.source }),
        ...(searchParams.isActive !== undefined && {
          isActive: searchParams.isActive === "true",
        }),
      },
      orderBy: { createdAt: "desc" },
      select: ruleSelect,
    });
    return json({ success: true, rules });
  },
);

const { action: createRule } = createActionApiRoute(
  {
    body: IngestionRuleCreateSchema,
    method: "POST",
    allowJWT: true,
    authorization: { action: "manage" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "User workspace not found" }, { status: 404 });
    }
    const rule = await prisma.ingestionRule.create({
      data: {
        ...body,
        workspaceId: authentication.workspaceId,
        userId: authentication.userId,
      },
      select: ruleSelect,
    });
    return json({ success: true, rule });
  },
);

const { action: updateRule } = createActionApiRoute(
  {
    body: IngestionRuleUpdateSchema,
    method: "PUT",
    allowJWT: true,
    authorization: { action: "manage" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "User workspace not found" }, { status: 404 });
    }
    const { id, ...data } = body;
    const rule = await prisma.ingestionRule.update({
      where: { id, workspaceId: authentication.workspaceId },
      data,
      select: ruleSelect,
    });
    return json({ success: true, rule });
  },
);

const action = (args: ActionFunctionArgs) =>
  args.request.method === "POST" ? createRule(args) : updateRule(args);

export { action, loader };

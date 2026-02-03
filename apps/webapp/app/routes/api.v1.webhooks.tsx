import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { redirect, json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { apiCors } from "~/utils/apiCors";

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return apiCors(request, json({}));
  }
  return new Response(null, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  const authResult = await authenticateHybridRequest(request, { allowJWT: true });

  if (!authResult) {
    return apiCors(request, json({ error: "Authentication required" }, { status: 401 }));
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    include: { Workspace: true },
  });

  if (!user?.Workspace) {
    return apiCors(request, json({ error: "User workspace not found" }, { status: 400 }));
  }

  if (request.method === "POST") {
    let url: string;
    let secret: string | null = null;
    let eventTypes: string[] = ["activity.created"];

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      url = body.url;
      secret = body.secret || null;
      eventTypes = body.eventTypes || eventTypes;
    } else {
      const formData = await request.formData();
      url = formData.get("url") as string;
      secret = (formData.get("secret") as string) || null;
    }

    if (!url) {
      return apiCors(request, json({ error: "Missing required fields" }, { status: 400 }));
    }

    try {
      new URL(url);
    } catch {
      return apiCors(request, json({ error: "Invalid URL format" }, { status: 400 }));
    }

    try {
      const webhook = await prisma.webhookConfiguration.create({
        data: {
          url,
          secret,
          eventTypes,
          workspaceId: user.Workspace.id,
          userId: authResult.userId,
          isActive: true,
        },
      });

      // For form submissions from webapp, redirect
      if (!contentType.includes("application/json")) {
        return redirect("/settings/webhooks");
      }

      return apiCors(
        request,
        json({
          success: true,
          webhook: {
            id: webhook.id,
            url: webhook.url,
            eventTypes: webhook.eventTypes,
            isActive: webhook.isActive,
            createdAt: webhook.createdAt,
          },
        }),
      );
    } catch (error) {
      logger.error("Error creating webhook:", { error });
      return apiCors(request, json({ error: "Failed to create webhook" }, { status: 500 }));
    }
  }

  return apiCors(request, json({ error: "Method not allowed" }, { status: 405 }));
}

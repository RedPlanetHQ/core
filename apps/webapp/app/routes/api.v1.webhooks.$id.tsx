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

export async function action({ request, params }: ActionFunctionArgs) {
  const authResult = await authenticateHybridRequest(request, { allowJWT: true });

  if (!authResult) {
    return apiCors(request, json({ error: "Authentication required" }, { status: 401 }));
  }

  const webhookId = params.id;

  if (!webhookId) {
    return apiCors(request, json({ error: "Webhook ID is required" }, { status: 400 }));
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    include: { Workspace: true },
  });

  if (!user?.Workspace) {
    return apiCors(request, json({ error: "User workspace not found" }, { status: 400 }));
  }

  // Verify webhook belongs to the workspace
  const webhook = await prisma.webhookConfiguration.findFirst({
    where: {
      id: webhookId,
      workspaceId: user.Workspace.id,
    },
  });

  if (!webhook) {
    return apiCors(request, json({ error: "Webhook not found" }, { status: 404 }));
  }

  const contentType = request.headers.get("content-type") || "";

  // Handle DELETE - either via DELETE method or POST with _method=DELETE
  if (request.method === "DELETE") {
    try {
      await prisma.webhookConfiguration.delete({
        where: { id: webhookId },
      });

      return apiCors(request, json({ success: true }));
    } catch (error) {
      logger.error("Error deleting webhook:", { error });
      return apiCors(request, json({ error: "Failed to delete webhook" }, { status: 500 }));
    }
  }

  if (request.method === "POST") {
    let method: string | null = null;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      method = body._method;
    } else {
      const formData = await request.formData();
      method = formData.get("_method") as string;
    }

    if (method === "DELETE") {
      try {
        await prisma.webhookConfiguration.delete({
          where: { id: webhookId },
        });

        // For form submissions from webapp, redirect
        if (!contentType.includes("application/json")) {
          return redirect("/settings/webhooks");
        }

        return apiCors(request, json({ success: true }));
      } catch (error) {
        logger.error("Error deleting webhook:", { error });
        return apiCors(request, json({ error: "Failed to delete webhook" }, { status: 500 }));
      }
    }
  }

  return apiCors(request, json({ error: "Method not allowed" }, { status: 405 }));
}

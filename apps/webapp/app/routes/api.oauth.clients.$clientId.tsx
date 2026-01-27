import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  json,
} from "@remix-run/node";
import { requireAuth } from "~/utils/auth-helper";
import crypto from "crypto";
import { prisma } from "~/db.server";

// GET /api/oauth/clients/:clientId - Get specific OAuth client
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const user = await requireAuth(request);

  const { clientId } = params;

  if (!clientId) {
    return json({ error: "Client ID is required" }, { status: 400 });
  }

  try {

    if (!user.workspaceId) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    const client = await prisma.oAuthClient.findFirst({
      where: {
        id: clientId,
        workspaceId: user.workspaceId,
      },
      select: {
        id: true,
        clientId: true,
        name: true,
        description: true,
        redirectUris: true,
        allowedScopes: true,
        requirePkce: true,
        logoUrl: true,
        homepageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!client) {
      return json({ error: "OAuth client not found" }, { status: 404 });
    }

    return json({ client });
  } catch (error) {
    console.error("Error fetching OAuth client:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const user = await requireAuth(request);

  const { clientId } = params;
  const method = request.method;

  if (!clientId) {
    return json({ error: "Client ID is required" }, { status: 400 });
  }

  try {
  

    if (!user?.workspaceId) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    // Verify client exists and belongs to user's workspace
    const existingClient = await prisma.oAuthClient.findFirst({
      where: {
        id: clientId,
        workspaceId: user.workspaceId,
      },
    });

    if (!existingClient) {
      return json({ error: "OAuth client not found" }, { status: 404 });
    }

    // PATCH - Update OAuth client
    if (method === "PATCH") {
      const body = await request.json();
      const {
        name,
        description,
        redirectUris,
        allowedScopes,
        requirePkce,
        logoUrl,
        homepageUrl,
        isActive,
      } = body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (redirectUris !== undefined) {
        updateData.redirectUris = Array.isArray(redirectUris)
          ? redirectUris.join(",")
          : redirectUris;
      }
      if (allowedScopes !== undefined) {
        updateData.allowedScopes = Array.isArray(allowedScopes)
          ? allowedScopes.join(",")
          : allowedScopes;
      }
      if (requirePkce !== undefined) updateData.requirePkce = requirePkce;
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
      if (homepageUrl !== undefined) updateData.homepageUrl = homepageUrl;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updatedClient = await prisma.oAuthClient.update({
        where: { id: clientId },
        data: updateData,
        select: {
          id: true,
          clientId: true,
          name: true,
          description: true,
          redirectUris: true,
          allowedScopes: true,
          requirePkce: true,
          logoUrl: true,
          homepageUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return json({ success: true, client: updatedClient });
    }

    // POST - Regenerate client secret
    if (method === "POST") {
      const body = await request.json();
      const { action } = body;

      if (action === "regenerate_secret") {
        const newClientSecret = crypto.randomBytes(32).toString("hex");

        const updatedClient = await prisma.oAuthClient.update({
          where: { id: clientId },
          data: { clientSecret: newClientSecret },
          select: {
            id: true,
            clientId: true,
            clientSecret: true,
            name: true,
          },
        });

        return json({
          success: true,
          client: updatedClient,
          message:
            "Client secret regenerated successfully. Save it securely - it won't be shown again.",
        });
      }

      return json({ error: "Invalid action" }, { status: 400 });
    }

    // DELETE - Delete OAuth client
    if (method === "DELETE") {
      await prisma.oAuthClient.delete({
        where: { id: clientId },
      });

      return json({
        success: true,
        message: "OAuth client deleted successfully",
      });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Error managing OAuth client:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

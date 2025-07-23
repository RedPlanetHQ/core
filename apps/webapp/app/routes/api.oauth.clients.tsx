import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  json,
} from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "~/utils/auth-helper";
import crypto from "crypto";

const prisma = new PrismaClient();

// GET /api/oauth/clients - List OAuth clients for user's workspace
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireAuth(request);

  try {
    // Get user's workspace
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      include: { Workspace: true },
    });

    if (!userRecord?.Workspace) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    const clients = await prisma.oAuthClient.findMany({
      where: { workspaceId: userRecord.Workspace.id },
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
      orderBy: { createdAt: "desc" },
    });

    return json({ clients });
  } catch (error) {
    console.error("Error fetching OAuth clients:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// POST /api/oauth/clients - Create new OAuth client
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await requireAuth(request);

  try {
    const body = await request.json();

    const {
      name,
      description,
      redirectUris,
      allowedScopes,
      requirePkce,
      logoUrl,
      homepageUrl,
    } = body;

    // Validate required fields
    if (!name || !redirectUris) {
      return json(
        { error: "Name and redirectUris are required" },
        { status: 400 },
      );
    }

    // Validate scopes
    const validScopes = [
      // Authentication scopes (Google-style)
      'profile', 'email', 'openid',
      // Integration scope
      'integration'
    ];

    const requestedScopes = Array.isArray(allowedScopes) ? allowedScopes : [allowedScopes || 'read'];
    const invalidScopes = requestedScopes.filter(scope => !validScopes.includes(scope));
    
    if (invalidScopes.length > 0) {
      return json(
        { error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes are: ${validScopes.join(', ')}` },
        { status: 400 },
      );
    }

    // Get user's workspace
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      include: { Workspace: true },
    });

    if (!userRecord?.Workspace) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    // Generate client credentials
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString("hex");

    // Create OAuth client
    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecret,
        name,
        description: description || null,
        redirectUris: Array.isArray(redirectUris)
          ? redirectUris.join(",")
          : redirectUris,
        allowedScopes: requestedScopes.join(","),
        requirePkce: requirePkce || false,
        logoUrl: logoUrl || null,
        homepageUrl: homepageUrl || null,
        workspaceId: userRecord.Workspace.id,
        createdById: user.id,
      },
      select: {
        id: true,
        clientId: true,
        clientSecret: true,
        name: true,
        description: true,
        redirectUris: true,
        allowedScopes: true,
        requirePkce: true,
        logoUrl: true,
        homepageUrl: true,
        isActive: true,
        createdAt: true,
      },
    });

    return json({
      success: true,
      client,
      message: "OAuth client created successfully",
    });
  } catch (error) {
    console.error("Error creating OAuth client:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

import { redirect } from "@remix-run/node";
import { getUserById } from "~/models/user.server";
import { sessionStorage } from "./sessionStorage.server";
import { getImpersonationId } from "./impersonation.server";
import { type Request as ERequest } from "express";
import { prisma } from "~/db.server";
import { getWorkspaceById } from "~/models/workspace.server";

export async function getUserId(
  request: Request | ERequest,
): Promise<string | undefined> {
  const impersonatedUserId = await getImpersonationId(request as Request);

  if (impersonatedUserId) return impersonatedUserId;

  const cookieHeader =
    request instanceof Request
      ? request.headers.get("Cookie")
      : request.headers["cookie"];

  let session = await sessionStorage.getSession(cookieHeader);
  let user = session.get("user");

  return user?.userId;
}

export async function getUserSession(
  request: Request | ERequest,
): Promise<{ userId: string; workspaceId?: string } | undefined> {
  const impersonatedUserId = await getImpersonationId(request as Request);

  if (impersonatedUserId) {
    // For impersonated users, get their workspace
    const workspaceId = await getWorkspaceId(request, impersonatedUserId);
    return { userId: impersonatedUserId, workspaceId };
  }

  const cookieHeader =
    request instanceof Request
      ? request.headers.get("Cookie")
      : request.headers["cookie"];

  let session = await sessionStorage.getSession(cookieHeader);
  let user = session.get("user");

  if (!user?.userId) return undefined;

  // Get workspaceId from cookie or fallback to first workspace
  const workspaceId = await getWorkspaceId(
    request,
    user.userId,
    user.workspaceId,
  );

  return {
    userId: user.userId,
    workspaceId,
  };
}

export async function getUser(request: Request) {
  const userId = await getUserId(request);
  if (userId === undefined) return null;

  const user = await getUserById(userId);
  if (user) return user;

  throw await logout(request);
}

export async function requireUserId(request: Request, redirectTo?: string) {
  const userId = await getUserId(request);
  if (!userId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([
      ["redirectTo", redirectTo ?? `${url.pathname}${url.search}`],
    ]);
    throw redirect(`/login?${searchParams}`);
  }
  return userId;
}

export async function requireUser(request: Request) {
  const userId = await requireUserId(request);

  const impersonationId = await getImpersonationId(request);
  const user = await getUserById(userId);
  if (user) {
    // Get workspaceId from session or fallback to first workspace
    const userSession = await getUserSession(request);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      admin: user.admin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      confirmedBasicDetails: user.confirmedBasicDetails,
      onboardingComplete: user.onboardingComplete,
      isImpersonating: !!impersonationId,
      workspaceId: userSession?.workspaceId,
    };
  }

  throw await logout(request);
}

export async function requireWorkpace(request: Request) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([
      ["redirectTo", `${url.pathname}${url.search}`],
    ]);
    throw redirect(`/login?${searchParams}`);
  }
  const workspace = await getWorkspaceById(workspaceId);
  return workspace;
}

export async function logout(request: Request) {
  return redirect("/logout");
}

export async function getWorkspaceId(
  request: Request | ERequest,
  userId: string,
  providedWorkspaceId?: string,
): Promise<string | undefined> {
  // 1. If workspaceId is provided (from cookie or PAT), use it
  if (providedWorkspaceId) {
    return providedWorkspaceId;
  }

  // 2. Fallback: Get the first workspace for the user
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: {
      userId,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      workspaceId: true,
    },
  });

  return userWorkspace?.workspaceId;
}

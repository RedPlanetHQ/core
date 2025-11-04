import { redirect } from "@remix-run/node";
import { getUserById } from "~/models/user.server";
import { sessionStorage } from "./sessionStorage.server";
import { getImpersonationId } from "./impersonation.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { type Request as ERequest } from "express";

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
      workspaceId: user.Workspace?.id,
    };
  }

  throw await logout(request);
}

export async function requireWorkpace(request: Request) {
  const userId = await requireUserId(request);
  const workspace = await getWorkspaceByUser(userId);

  if (!workspace) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([
      ["redirectTo", `${url.pathname}${url.search}`],
    ]);
    throw redirect(`/login?${searchParams}`);
  }

  return workspace;
}

export async function logout(request: Request) {
  return redirect("/logout");
}

import { json, redirect } from "@remix-run/node";
import { getUser } from "~/services/session.server";
import { authenticateApiRequestWithPersonalAccessToken } from "~/services/personalAccessToken.server";
import { oauth2Service } from "~/services/oauth2.server";
import { getUserById } from "~/models/user.server";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  admin: boolean;
  createdAt: Date;
  updatedAt: Date;
  confirmedBasicDetails: boolean;
  onboardingComplete: boolean;
  authMethod: 'session' | 'pat' | 'oauth2';
  oauth2?: {
    clientId: string;
    scope: string | null;
  };
  workspaceId?: string;
};

/**
 * Authenticates a request using session, PAT, or OAuth2 access token
 * Returns the authenticated user or throws an error response
 */
export async function requireAuth(request: Request): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get("authorization");
  
  // Try OAuth2 access token authentication
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    
    // Check if it's a PAT token first
    const patAuth = await authenticateApiRequestWithPersonalAccessToken(request);
    if (patAuth) {
      const user = await getUserById(patAuth.userId);
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
          authMethod: 'pat',
          workspaceId: patAuth.workspaceId
        };
      }
    }
    
    // Try OAuth2 access token
    try {
      const accessToken = await oauth2Service.validateAccessToken(token);
      return {
        id: accessToken.user.id,
        email: accessToken.user.email,
        name: accessToken.user.name,
        displayName: accessToken.user.displayName,
        avatarUrl: accessToken.user.avatarUrl,
        admin: accessToken.user.admin,
        createdAt: accessToken.user.createdAt,
        updatedAt: accessToken.user.updatedAt,
        confirmedBasicDetails: accessToken.user.confirmedBasicDetails,
        onboardingComplete: accessToken.user.onboardingComplete,
        authMethod: 'oauth2',
        oauth2: {
          clientId: accessToken.client.clientId,
          scope: accessToken.scope,
        },
        workspaceId: accessToken.workspaceId

      };
    } catch (error) {
      // OAuth2 token validation failed, continue to session auth
    }
  }

  // Try session authentication
  const sessionUser = await getUser(request);
  if (sessionUser) {
    return {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      displayName: sessionUser.displayName,
      avatarUrl: sessionUser.avatarUrl,
      admin: sessionUser.admin,
      createdAt: sessionUser.createdAt,
      updatedAt: sessionUser.updatedAt,
      confirmedBasicDetails: sessionUser.confirmedBasicDetails,
      onboardingComplete: sessionUser.onboardingComplete,
      authMethod: 'session',
    };
  }

  // If no authentication method worked, return 401
  throw json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Optional authentication - returns user if authenticated, null otherwise
 */
export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  try {
    return await requireAuth(request);
  } catch (error) {
    return null;
  }
}
import { type UIMatch } from "@remix-run/react";

import { type loader } from "~/root";
import { useChanged } from "./useChanged";
import { useTypedMatchesData } from "./useTypedMatchData";
import { type User } from "@prisma/client";

export interface ExtendedUser extends User {
  availableCredits: number;
  totalCredits: number;
}

export function useIsImpersonating(matches?: UIMatch[]) {
  const data = useTypedMatchesData({
    id: "routes/_app.workspace.$workspaceSlug",
    matches,
  });
  return data?.isImpersonating === true;
}

export function useOptionalUser(matches?: UIMatch[]): ExtendedUser | undefined {
  const routeMatch = useTypedMatchesData<typeof loader>({
    id: "root",
    matches,
  });

  return routeMatch?.user
    ? {
        ...routeMatch?.user,
        availableCredits: routeMatch?.availableCredits,
        totalCredits: routeMatch?.totalCredits,
      }
    : undefined;
}

export function useUser(matches?: UIMatch[]): ExtendedUser {
  const maybeUser = useOptionalUser(matches);
  if (!maybeUser) {
    throw new Error(
      "No user found in root loader, but user is required by useUser. If user is optional, try useOptionalUser instead.",
    );
  }
  return maybeUser;
}

export function useUserChanged(
  callback: (user: ExtendedUser | undefined) => void,
) {
  useChanged(useOptionalUser, callback);
}

export function useHasAdminAccess(matches?: UIMatch[]): boolean {
  const user = useOptionalUser(matches);
  const isImpersonating = useIsImpersonating(matches);

  return Boolean(user?.admin) || isImpersonating;
}

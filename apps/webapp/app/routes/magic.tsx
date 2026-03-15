import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/server-runtime";
import { authenticator } from "~/services/auth.server";
import { logger } from "~/services/logger.service";
import { saveSession } from "~/services/sessionStorage.server";
import { redirectCookie } from "./auth.google";
import { getUserById } from "~/models/user.server";
import { safeRedirect } from "~/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const cookie = request.headers.get("Cookie");
  const redirectValue = await redirectCookie.parse(cookie);
  const authuser = await authenticator.authenticate("email-link", request);
  const redirectTo = safeRedirect(redirectValue, "/");

  const headers = await saveSession(request, authuser);

  logger.debug("auth.google.callback authuser", {
    authuser,
  });

  const user = await getUserById(authuser.userId);
  if (user && !user.onboardingComplete && !redirectTo.startsWith("/onboarding")) {
    const onboardingUrl =
      redirectTo && redirectTo !== "/"
        ? `/onboarding?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/onboarding";
    return redirect(onboardingUrl, { headers });
  }

  return redirect(redirectTo, {
    headers,
  });
}

import { redirect, type LoaderFunction } from "@remix-run/node";
import { authenticator } from "~/services/auth.server";
import { redirectCookie } from "./auth.google";
import { logger } from "~/services/logger.service";
import { saveSession } from "~/services/sessionStorage.server";
import { safeRedirect } from "~/utils";
import { getUserById } from "~/models/user.server";

export let loader: LoaderFunction = async ({ request }) => {
  const cookie = request.headers.get("Cookie");
  const redirectValue = await redirectCookie.parse(cookie);
  const redirectTo = safeRedirect(redirectValue, "/");

  logger.debug("auth.google.callback loader", {
    redirectTo,
  });

  const authuser = await authenticator.authenticate("google", request);
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
};

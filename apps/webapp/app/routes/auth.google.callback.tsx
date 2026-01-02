import { redirect, type LoaderFunction } from "@remix-run/node";
import { authenticator } from "~/services/auth.server";
import { redirectCookie } from "./auth.google";
import { logger } from "~/services/logger.service";
import { saveSession } from "~/services/sessionStorage.server";
import { safeRedirect } from "~/utils";

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

  return redirect(redirectTo, {
    headers,
  });
};

import { createCookieSessionStorage } from "@remix-run/node";
import { createThemeSessionResolver } from "remix-themes";
import { env } from "~/env.server";
import { type AuthUser } from "./authUser";

let SESSION_KEY = "user";

// Check if origin uses HTTPS
const isHttps = env.APP_ORIGIN?.startsWith("https://") ?? false;

export const sessionStorage = createCookieSessionStorage<{
  [SESSION_KEY]: AuthUser;
}>({
  cookie: {
    name: "__session__core", // use any name you want here
    sameSite: "lax", // this helps with CSRF
    path: "/", // remember to add this so the cookie will work in all routes
    httpOnly: true, // for security reasons, make this cookie http only
    secrets: [env.SESSION_SECRET],
    secure: isHttps, // enable secure cookies only when using HTTPS
    maxAge: 60 * 60 * 24 * 365, // 7 days
  },
});

export const themeStorage = createCookieSessionStorage({
  cookie: {
    name: "__theme",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: [env.SESSION_SECRET],
    secure: isHttps, // enable secure cookies only when using HTTPS
    maxAge: 60 * 60 * 24 * 365, // 1 year
  },
});

export const getSessionFromStore = async (request: Request) => {
  return await sessionStorage.getSession(request.headers.get("Cookie"));
};

export const saveSession = async (request: Request, user: AuthUser) => {
  const session = await getSessionFromStore(request);
  session.set(SESSION_KEY, user);
  return new Headers({
    "Set-Cookie": await sessionStorage.commitSession(session),
  });
};

export const themeSessionResolver = createThemeSessionResolver(sessionStorage);

export function getUserSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export const { getSession, commitSession, destroySession } = sessionStorage;

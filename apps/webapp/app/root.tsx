import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  type UseDataFunctionReturn,
  typedjson,
  useTypedLoaderData,
} from "remix-typedjson";

import styles from "./tailwind.css?url";

import { appEnvTitleTag } from "./utils";
import {
  commitSession,
  getSession,
  type ToastMessage,
} from "./models/message.server";
import { env } from "./env.server";
import { getUser } from "./services/session.server";
import { usePostHog } from "./hooks/usePostHog";
import {
  AppContainer,
  MainCenteredContainer,
} from "./components/layout/app-layout";
import { RouteErrorDisplay } from "./components/ErrorDisplay";
import { themeSessionResolver } from "./services/sessionStorage.server";
import {
  PreventFlashOnWrongTheme,
  Theme,
  ThemeProvider,
  useTheme,
} from "remix-themes";
import clsx from "clsx";
import { getUsageSummary } from "./services/billing.server";
import { Toaster } from "./components/ui/toaster";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSession(request.headers.get("cookie"));
  const toastMessage = session.get("toastMessage") as ToastMessage;
  const { getTheme } = await themeSessionResolver(request);

  const posthogProjectKey = env.POSTHOG_PROJECT_KEY;
  const telemetryEnabled = env.TELEMETRY_ENABLED;
  const user = await getUser(request);
  const usageSummary = await getUsageSummary(user?.Workspace?.id as string);

  return typedjson(
    {
      user: user,
      availableCredits: usageSummary?.credits.available ?? 0,
      totalCredits: usageSummary?.credits.monthly ?? 0,
      toastMessage,
      theme: getTheme(),
      posthogProjectKey,
      telemetryEnabled,
      appEnv: env.APP_ENV,
      appOrigin: env.APP_ORIGIN,
    },
    { headers: { "Set-Cookie": await commitSession(session) } },
  );
};

export const meta: MetaFunction = ({ data }) => {
  const typedData = data as UseDataFunctionReturn<typeof loader>;

  return [
    { title: `CORE${typedData && appEnvTitleTag(typedData.appEnv)}` },
    {
      name: "viewport",
      content: "width=1024, initial-scale=1",
    },
    {
      name: "robots",
      content:
        typeof window === "undefined" ||
        window.location.hostname !== "core.mysigma.ai"
          ? "noindex, nofollow"
          : "index, follow",
    },
  ];
};

export function ErrorBoundary() {
  return (
    <>
      <html lang="en" className="h-full">
        <head>
          <meta charSet="utf-8" />

          <Meta />
          <Links />
        </head>
        <body className="bg-background-2 h-full overflow-hidden">
          <AppContainer>
            <MainCenteredContainer>
              <RouteErrorDisplay />
            </MainCenteredContainer>
          </AppContainer>
          <Scripts />
        </body>
      </html>
    </>
  );
}

function App() {
  const { posthogProjectKey, telemetryEnabled } =
    useTypedLoaderData<typeof loader>();

  usePostHog(posthogProjectKey, telemetryEnabled);
  const [theme] = useTheme();

  return (
    <>
      <html lang="en" className={clsx(theme, "h-full")}>
        <head>
          <Meta />
          <Links />
          <PreventFlashOnWrongTheme ssrTheme={Boolean(theme)} />
        </head>
        <body className="bg-background-2 h-[100vh] h-full w-[100vw] overflow-hidden font-sans">
          <Outlet />
          <Toaster />
          <ScrollRestoration />

          <Scripts />
        </body>
      </html>
    </>
  );
}

// Wrap your app with ThemeProvider.
// `specifiedTheme` is the stored theme in the session storage.
// `themeAction` is the action name that's used to change the theme in the session storage.
export default function AppWithProviders() {
  return (
    <ThemeProvider
      specifiedTheme={Theme.LIGHT}
      disableTransitionOnThemeChange={true}
      themeAction="/action/set-theme"
    >
      <App />
    </ThemeProvider>
  );
}

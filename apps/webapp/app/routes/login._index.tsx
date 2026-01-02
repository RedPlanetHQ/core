import { type LoaderFunctionArgs } from "@remix-run/node";

import { redirect, typedjson, useTypedLoaderData } from "remix-typedjson";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import { Fieldset } from "~/components/ui/Fieldset";
import { isGoogleAuthSupported } from "~/services/auth.server";
import { setRedirectTo } from "~/services/redirectTo.server";
import { getUserId } from "~/services/session.server";
import { commitSession } from "~/services/sessionStorage.server";
import { requestUrl } from "~/utils/requestUrl.server";
import { env } from "~/env.server";

import { RiGoogleLine } from "@remixicon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Mail } from "lucide-react";
import Logo from "~/components/logo/logo";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/");

  const url = requestUrl(request);
  const redirectTo = url.searchParams.get("redirectTo");

  if (redirectTo) {
    const session = await setRedirectTo(request, redirectTo);

    return typedjson(
      {
        redirectTo,
        showGoogleAuth: isGoogleAuthSupported,
        emailLoginEnabled: env.ENABLE_EMAIL_LOGIN,
      },
      {
        headers: {
          "Set-Cookie": await commitSession(session),
        },
      },
    );
  } else {
    return typedjson({
      redirectTo: null,
      showGoogleAuth: isGoogleAuthSupported,
      emailLoginEnabled: env.ENABLE_EMAIL_LOGIN,
    });
  }
}

export default function LoginPage() {
  const data = useTypedLoaderData<typeof loader>();

  return (
    <LoginPageLayout>
      <Card className="w-full max-w-[350px] rounded-md bg-transparent p-3">
        <CardHeader className="flex flex-col items-center">
          <CardTitle className="text-2xl">Welcome to Core</CardTitle>
        </CardHeader>

        <CardContent className="pt-2">
          <Fieldset className="w-full">
            <div className="flex flex-col gap-y-2">
              <div className="mb-10 flex justify-center">
                <Logo size={60} />
              </div>

              <p className="text-muted-foreground/70 mb-2 text-center">
                By connecting a third-party account, you <br /> agree to our{" "}
                <a
                  href="https://getcore.me/terms"
                  target="_blank"
                  className="text-muted-foreground underline"
                >
                  Terms of Service
                </a>{" "}
                and
                <a
                  href="https://getcore.me/privacy"
                  target="_blank"
                  className="text-muted-foreground underline"
                >
                  {" "}
                  Privacy Policy
                </a>
              </p>
              {data.showGoogleAuth && (
                <Button
                  type="submit"
                  size="xl"
                  variant="secondary"
                  className="rounded-lg text-base"
                  data-action="continue with google"
                  onClick={() => {
                    const redirect = data.redirectTo
                      ? `?redirectTo=${encodeURIComponent(data.redirectTo)}`
                      : "";
                    window.location.href = `/auth/google${redirect}`;
                  }}
                >
                  <RiGoogleLine className={"mr-1 size-5"} />
                  <span>Continue with Google</span>
                </Button>
              )}

              {data.emailLoginEnabled && (
                <Button
                  variant="secondary"
                  size="xl"
                  data-action="continue with email"
                  className="text-text-bright"
                  onClick={() => {
                    const redirect = data.redirectTo
                      ? `?redirectTo=${encodeURIComponent(data.redirectTo)}`
                      : "";
                    window.location.href = `/login/magic${redirect}`;
                  }}
                >
                  <Mail className="text-text-bright mr-2 size-5" />
                  Continue with Email
                </Button>
              )}
            </div>
          </Fieldset>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}

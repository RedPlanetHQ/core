import { type LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";

import { redirect, typedjson, useTypedLoaderData } from "remix-typedjson";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import { Fieldset } from "~/components/ui/Fieldset";
import { isGoogleAuthSupported } from "~/services/auth.server";
import { setRedirectTo } from "~/services/redirectTo.server";
import { getUserId } from "~/services/session.server";
import { commitSession } from "~/services/sessionStorage.server";
import { requestUrl } from "~/utils/requestUrl.server";
import { env } from "~/env.server";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Mail, Shield, Lock } from "lucide-react";
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

function SecurityScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <LoginPageLayout>
      <Card className="w-full max-w-[450px] rounded-md bg-transparent p-3">
        <CardHeader className="flex flex-col items-center">
          <div className="mb-4 flex justify-center">
            <Logo size={60} />
          </div>
          <CardTitle className="text-3xl font-normal">Privacy</CardTitle>
        </CardHeader>

        <CardContent className="pt-2">
          <Fieldset className="w-full">
            <div className="flex flex-col gap-y-4">
              <p className="text-muted-foreground mb-2 text-center text-sm leading-relaxed">
                Core is your digital brain that remembers your context,
                conversations, and what matters to you. Connect to get started.
              </p>

              {/* Security Section */}
              <div className="flex gap-3 text-left">
                <Shield className="mt-1 size-6 flex-shrink-0" />
                <div>
                  <h2 className="mb-1 text-base font-semibold">Security</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    We take security as our top priority and are CASA Tier II
                    certified by external auditors.
                  </p>
                </div>
              </div>

              {/* Privacy Section */}
              <div className="mb-4 flex gap-3 text-left">
                <Lock className="mt-1 size-6 flex-shrink-0" />
                <div>
                  <h2 className="mb-1 text-base font-semibold">Privacy</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Your digital brain is private. No human (except you) will
                    see any of your data unless you opt-in to sharing analytics.
                  </p>
                </div>
              </div>

              {/* Continue Button */}
              <Button
                onClick={onContinue}
                size="xl"
                variant="secondary"
                className="w-full rounded-lg text-base font-medium"
              >
                Continue
              </Button>

              {/* Footer Links */}
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                <a href="https://getcore.me/privacy" target="_blank">
                  Privacy
                </a>
                <span>|</span>
                <a href="https://getcore.me/terms" target="_blank">
                  Terms
                </a>
              </div>
            </div>
          </Fieldset>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}

export default function LoginPage() {
  const data = useTypedLoaderData<typeof loader>();
  const [showSecurity, setShowSecurity] = useState(false);

  const handleGetStarted = () => {
    setShowSecurity(true);
  };

  const handleSecurityContinue = () => {
    const redirect = data.redirectTo
      ? `?redirectTo=${encodeURIComponent(data.redirectTo)}`
      : "";
    window.location.href = `/auth/google${redirect}`;
  };

  if (showSecurity) {
    return <SecurityScreen onContinue={handleSecurityContinue} />;
  }

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
                  data-action="get started"
                  onClick={handleGetStarted}
                >
                  <span>Get Started</span>
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

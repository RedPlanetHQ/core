import {
  createCookie,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Form, useNavigation } from "@remix-run/react";
import { LoaderCircle, Mail } from "lucide-react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import { Button } from "~/components/ui";
import { Fieldset } from "~/components/ui/Fieldset";
import { FormButtons } from "~/components/ui/FormButtons";
import { Input } from "~/components/ui/input";
import { Paragraph } from "~/components/ui/Paragraph";
import { Cookie } from "@mjackson/headers";
import { authenticator } from "~/services/auth.server";
import { getUserId } from "~/services/session.server";
import {
  commitSession,
  getUserSession,
} from "~/services/sessionStorage.server";
import { env } from "~/env.server";
import Logo from "~/components/logo/logo";
import { redirectCookie } from "./auth.google";
import { requestUrl } from "~/utils/requestUrl.server";

export const meta: MetaFunction = ({ matches }) => {
  const parentMeta = matches
    .flatMap((match) => match.meta ?? [])
    .filter((meta) => {
      if ("title" in meta) return false;
      if ("name" in meta && meta.name === "viewport") return false;
      return true;
    });

  return [
    ...parentMeta,
    { title: `Login to C.O.R.E.` },
    {
      name: "viewport",
      content: "width=device-width,initial-scale=1",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<any> {
  if (!env.ENABLE_EMAIL_LOGIN) {
    return typedjson({ emailLoginEnabled: false });
  }

  const userId = await getUserId(request);
  if (userId) return redirect("/");

  const session = await getUserSession(request);
  const error = session.get("auth:error");

  let magicLinkError: string | undefined | unknown;
  if (error) {
    if ("message" in error) {
      magicLinkError = error.message;
    } else {
      magicLinkError = JSON.stringify(error, null, 2);
    }
  }

  const magicLinkSent = new Cookie(request.headers.get("cookie") ?? "").has(
    "core_magiclink",
  );

  return typedjson(
    {
      emailLoginEnabled: true,
      magicLinkSent,
      magicLinkError,
    },
    {
      headers: { "Set-Cookie": await commitSession(session) },
    },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (!env.ENABLE_EMAIL_LOGIN) {
    throw new Error("Magic link login is not enabled");
  }

  const clonedRequest = request.clone();

  const payload = Object.fromEntries(await clonedRequest.formData());

  const { action } = z
    .object({
      action: z.enum(["send", "reset"]),
    })
    .parse(payload);

  if (action === "send") {
    const url = requestUrl(request);
    const redirectTo = url.searchParams.get("redirectTo");

    const headers = await authenticator
      .authenticate("email-link", request)
      .catch((headers) => headers);

    // Store redirectTo in cookie if present
    if (redirectTo && headers instanceof Headers) {
      headers.append("Set-Cookie", await redirectCookie.serialize(redirectTo));
    }

    throw redirect("/login/magic", { headers });
  } else {
    const myCookie = createCookie("core_magiclink");

    return redirect("/login/magic", {
      headers: {
        "Set-Cookie": await myCookie.serialize("", {
          maxAge: 0,
          path: "/",
        }),
      },
    });
  }
}

export default function LoginMagicLinkPage() {
  const data = useTypedLoaderData<typeof loader>();
  const navigate = useNavigation();

  if (!data.emailLoginEnabled) {
    return (
      <LoginPageLayout>
        <Paragraph className="text-center">
          Magic link login is not enabled.
        </Paragraph>
      </LoginPageLayout>
    );
  }

  const isLoading =
    (navigate.state === "loading" || navigate.state === "submitting") &&
    navigate.formAction !== undefined &&
    navigate.formData?.get("action") === "send";

  return (
    <LoginPageLayout>
      <Form method="post">
        <div className="flex flex-col items-center justify-center">
          {data.magicLinkSent ? (
            <Card className="min-w-[0] rounded-md bg-transparent p-3 md:min-w-[500px]">
              <CardHeader className="flex flex-col items-center">
                <CardTitle className="mb-0 text-2xl">
                  Check your magic link
                </CardTitle>
              </CardHeader>

              <Fieldset className="flex w-full flex-col items-center gap-y-2 px-2">
                <div className="mb-10 flex justify-center">
                  <Logo size={60} />
                </div>

                <p className="text-md text-muted-foreground text-center">
                  {" "}
                  The magic link is printed in the container <br />
                  logs if you are using Docker, otherwise <br />
                  check your server logs.
                </p>
                <FormButtons
                  cancelButton={<></>}
                  confirmButton={
                    <Button
                      type="submit"
                      name="action"
                      value="reset"
                      size="lg"
                      variant="secondary"
                      data-action="re-enter email"
                    >
                      Re-enter email
                    </Button>
                  }
                  className="justify-center"
                />
              </Fieldset>
            </Card>
          ) : (
            <Card className="w-full max-w-[350px] rounded-md bg-transparent p-3">
              <CardHeader className="flex flex-col items-center">
                <CardTitle className="text-2xl">Welcome to Core</CardTitle>
              </CardHeader>
              <CardContent className="pt-2 pl-2">
                <Fieldset className="flex w-full flex-col items-center gap-y-2">
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
                  <Input
                    type="email"
                    name="email"
                    className="h-9"
                    spellCheck={false}
                    placeholder="Email Address"
                    required
                    autoFocus
                  />

                  <div className="flex w-full">
                    <Button
                      name="action"
                      value="send"
                      type="submit"
                      variant="secondary"
                      full
                      size="xl"
                      className="w-full"
                      disabled={isLoading}
                      data-action="send a magic link"
                    >
                      {isLoading ? (
                        <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="text-text-bright mr-2 size-5" />
                      )}
                      {isLoading ? (
                        <span className="text-text-bright">Sending…</span>
                      ) : (
                        <span className="text-text-bright">
                          Send a magic link
                        </span>
                      )}
                    </Button>
                  </div>
                  {data.magicLinkError && <>{data.magicLinkError}</>}
                </Fieldset>
              </CardContent>
            </Card>
          )}
        </div>
      </Form>
    </LoginPageLayout>
  );
}

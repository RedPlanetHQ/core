import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { getUser } from "~/services/session.server";
import {
  oauth2Service,
  OAuth2Errors,
  type OAuth2AuthorizeRequest,
} from "~/services/oauth2.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Arrows } from "~/components/icons";
import Logo from "~/components/logo/logo";
import { AlignLeft, LayoutGrid, Pen } from "lucide-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Check if user is authenticated
  const user = await getUser(request);

  if (!user) {
    // Redirect to login with return URL
    const url = new URL(request.url);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", url.pathname + url.search);
    return redirect(loginUrl.toString());
  }

  const url = new URL(request.url);
  let scopeParam = url.searchParams.get("scope") || undefined;

  // If scope is present, remove spaces after commas (e.g., "read, write" -> "read,write")
  if (scopeParam) {
    scopeParam = scopeParam
      .split(",")
      .map((s) => s.trim())
      .join(",");
  } else {
    throw new Error("Scope is not found");
  }

  const params: OAuth2AuthorizeRequest = {
    client_id: url.searchParams.get("client_id") || "",
    redirect_uri: url.searchParams.get("redirect_uri") || "",
    response_type: url.searchParams.get("response_type") || "",
    scope: scopeParam,
    state: url.searchParams.get("state") || undefined,
    code_challenge: url.searchParams.get("code_challenge") || undefined,
    code_challenge_method:
      url.searchParams.get("code_challenge_method") || undefined,
  };

  // Validate required parameters
  if (!params.client_id || !params.redirect_uri || !params.response_type) {
    return redirect(
      `${params.redirect_uri}?error=${OAuth2Errors.INVALID_REQUEST}&error_description=Missing required parameters${params.state ? `&state=${params.state}` : ""}`,
    );
  }

  // Only support authorization code flow
  if (params.response_type !== "code") {
    return redirect(
      `${params.redirect_uri}?error=${OAuth2Errors.UNSUPPORTED_RESPONSE_TYPE}&error_description=Only authorization code flow is supported${params.state ? `&state=${params.state}` : ""}`,
    );
  }

  try {
    // Validate client
    const client = await oauth2Service.validateClient(params.client_id);

    // Validate redirect URI
    if (!oauth2Service.validateRedirectUri(client, params.redirect_uri)) {
      return redirect(
        `${params.redirect_uri}?error=${OAuth2Errors.INVALID_REQUEST}&error_description=Invalid redirect URI${params.state ? `&state=${params.state}` : ""}`,
      );
    }

    return {
      user,
      client,
      params,
    };
  } catch (error) {
    return redirect(
      `${params.redirect_uri}?error=${OAuth2Errors.INVALID_CLIENT}&error_description=Invalid client${params.state ? `&state=${params.state}` : ""}`,
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await getUser(request);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const action = formData.get("action");

  const params: OAuth2AuthorizeRequest = {
    client_id: formData.get("client_id") as string,
    redirect_uri: formData.get("redirect_uri") as string,
    response_type: formData.get("response_type") as string,
    scope: (formData.get("scope") as string) || undefined,
    state: (formData.get("state") as string) || undefined,
    code_challenge: (formData.get("code_challenge") as string) || undefined,
    code_challenge_method:
      (formData.get("code_challenge_method") as string) || undefined,
  };

  if (action === "deny") {
    return redirect(
      `${params.redirect_uri}?error=${OAuth2Errors.ACCESS_DENIED}&error_description=User denied access${params.state ? `&state=${params.state}` : ""}`,
    );
  }

  if (action === "allow") {
    try {
      // Validate client again
      const client = await oauth2Service.validateClient(params.client_id);

      if (!oauth2Service.validateRedirectUri(client, params.redirect_uri)) {
        return redirect(
          `${params.redirect_uri}?error=${OAuth2Errors.INVALID_REQUEST}&error_description=Invalid redirect URI${params.state ? `&state=${params.state}` : ""}`,
        );
      }

      // Create authorization code
      const authCode = await oauth2Service.createAuthorizationCode({
        clientId: params.client_id,
        userId: user.id,
        redirectUri: params.redirect_uri,
        scope: params.scope,
        state: params.state,
        codeChallenge: params.code_challenge,
        codeChallengeMethod: params.code_challenge_method,
      });
      // Redirect back to client with authorization code
      const redirectUrl = new URL(params.redirect_uri);
      redirectUrl.searchParams.set("code", authCode);
      if (params.state) {
        redirectUrl.searchParams.set("state", params.state);
      }

      return redirect(redirectUrl.toString());
    } catch (error) {
      return redirect(
        `${params.redirect_uri}?error=${OAuth2Errors.SERVER_ERROR}&error_description=Failed to create authorization code${params.state ? `&state=${params.state}` : ""}`,
      );
    }
  }

  return redirect(
    `${params.redirect_uri}?error=${OAuth2Errors.INVALID_REQUEST}&error_description=Invalid action${params.state ? `&state=${params.state}` : ""}`,
  );
};

export default function OAuthAuthorize() {
  const { user, client, params } = useLoaderData<typeof loader>();

  const getIcon = (scope: string) => {
    if (scope === "read") {
      return <AlignLeft size={16} />;
    }

    return <Pen size={16} />;
  };

  return (
    <div className="bg-background-2 flex min-h-screen items-center justify-center">
      <Card className="bg-background-3 shadow-1 w-full max-w-md rounded-lg p-5">
        <CardContent>
          <div className="flex items-center justify-center gap-4">
            {client.logoUrl ? (
              <img
                src={client.logoUrl}
                alt={client.name}
                className="h-[40px] w-[40px] rounded"
              />
            ) : (
              <LayoutGrid size={40} />
            )}
            <Arrows size={16} />
            <Logo width={40} height={40} />
          </div>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-center space-x-3 text-center">
              <div>
                <p className="text-lg font-normal">
                  {client.name} is requesting access
                </p>
                <p className="text-muted-foreground text-sm">
                  Authenticating with your {user.name} workspace
                </p>
              </div>
            </div>

            <p className="text-muted-foreground mb-2 text-sm">Permissions</p>
            <ul className="text-muted-foreground text-sm">
              {params.scope?.split(",").map((scope, index, arr) => {
                const isFirst = index === 0;
                const isLast = index === arr.length - 1;
                return (
                  <li
                    key={index}
                    className={`border-border flex items-center gap-2 border-x border-t p-2 ${isLast ? "border-b" : ""} ${isFirst ? "rounded-tl-md rounded-tr-md" : ""} ${isLast ? "rounded-br-md rounded-bl-md" : ""} `}
                  >
                    <div>{getIcon(scope)}</div>
                    <div>
                      {scope.charAt(0).toUpperCase() + scope.slice(1)} access to
                      your workspace
                    </div>
                  </li>
                );
              })}
            </ul>

            <Form method="post" className="space-y-3">
              <input type="hidden" name="client_id" value={params.client_id} />
              <input
                type="hidden"
                name="redirect_uri"
                value={params.redirect_uri}
              />
              <input
                type="hidden"
                name="response_type"
                value={params.response_type}
              />
              {params.scope && (
                <input type="hidden" name="scope" value={params.scope} />
              )}
              {params.state && (
                <input type="hidden" name="state" value={params.state} />
              )}
              {params.code_challenge && (
                <input
                  type="hidden"
                  name="code_challenge"
                  value={params.code_challenge}
                />
              )}
              {params.code_challenge_method && (
                <input
                  type="hidden"
                  name="code_challenge_method"
                  value={params.code_challenge_method}
                />
              )}

              <div className="flex justify-end space-x-3">
                <Button
                  type="submit"
                  name="action"
                  value="deny"
                  size="lg"
                  variant="secondary"
                >
                  Deny
                </Button>
                <Button
                  type="submit"
                  name="action"
                  value="allow"
                  size="lg"
                  className="shadow-none"
                >
                  Allow Access
                </Button>
              </div>
            </Form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { CheckCircleIcon } from "lucide-react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  getInvitation,
  linkWhatsappInvitation,
} from "~/services/invitation.server";
import { logger } from "~/services/logger.service";

import { createPersonalAccessTokenFromAuthorizationCode } from "~/services/personalAccessToken.server";
import { requireUserId } from "~/services/session.server";

const ParamsSchema = z.object({
  code: z.string(),
});

const SearchParamsSchema = z.object({
  source: z.string().optional(),
  clientName: z.string().optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);

  const parsedParams = ParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    logger.info("Invalid params", { params });
    throw new Response(undefined, {
      status: 400,
      statusText: "Invalid params",
    });
  }

  const url = new URL(request.url);
  const searchObject = Object.fromEntries(url.searchParams.entries());

  const searchParams = SearchParamsSchema.safeParse(searchObject);

  const source =
    (searchParams.success ? searchParams.data.source : undefined) ?? "cli";
  const clientName =
    (searchParams.success ? searchParams.data.clientName : undefined) ??
    "unknown";

  try {
    const parsedBase64 = Buffer.from(parsedParams.data.code, "base64").toString(
      "utf-8",
    );
    const codeDetails = JSON.parse(parsedBase64);

    const personalAccessToken =
      await createPersonalAccessTokenFromAuthorizationCode(
        codeDetails.authorizationCode,
        userId,
        "whatsapp",
      );

    const invitation = await getInvitation(codeDetails.invitationId);

    // Link whatsapp number with user
    if (invitation && invitation.source === "whatsapp") {
      await linkWhatsappInvitation(
        userId,
        invitation.id,
        invitation.identifier,
      );
    }

    return typedjson({
      success: true as const,
      source,
      clientName,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    if (error instanceof Error) {
      return typedjson({
        success: false as const,
        error: error.message,
        source,
        clientName,
      });
    }

    logger.error(JSON.stringify(error));
    throw new Response(undefined, {
      status: 400,
      statusText:
        "Something went wrong, if this problem persists please contact support.",
    });
  }
};

export default function Page() {
  const result = useTypedLoaderData<typeof loader>();

  return (
    <LoginPageLayout>
      <Card className="w-full max-w-[350px] rounded-md bg-transparent p-3">
        <CardHeader className="flex flex-col items-center">
          <CardTitle className="text-2xl">Welcome to Core</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center space-y-4">
            {result.success ? (
              <div>
                <div className="mb-2 flex items-center gap-1">
                  <CheckCircleIcon className="h-6 w-6 text-emerald-500" />{" "}
                  Authentication Successful
                </div>
                <p>
                  {getInstructionsForSource(result.source, result.clientName)}
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-2">Authentication failed</div>
                <div className="my-2">{result.error}</div>
                <p>
                  There was a problem authenticating you, please try logging in
                  again.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}

const prettyClientNames: Record<string, string> = {
  "claude-code": "Claude Code",
  "cursor-vscode": "Cursor",
  "Visual Studio Code": "VSCode",
  "windsurf-client": "Windsurf",
  "claude-ai": "Claude Desktop",
  whatsapp: "Whatsapp",
  "core-cli": "Core cli",
};

function getInstructionsForSource(source: string, clientName: string) {
  if (source === "mcp") {
    if (clientName) {
      return `Return to your ${prettyClientNames[clientName] ?? clientName} to continue.`;
    }
  }

  // For non-MCP sources like whatsapp, email, etc.
  if (source && source !== "cli") {
    return `Return to your ${source} to continue.`;
  }

  return `Return to your terminal to continue.`;
}

import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import Logo from "~/components/logo/logo";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Fieldset } from "~/components/ui/Fieldset";
import { setPhoneNumber } from "~/models/user.server";

import { logger } from "~/services/logger.service";

import { createPersonalAccessTokenFromAuthorizationCode } from "~/services/personalAccessToken.server";
import { requireUser } from "~/services/session.server";

const ParamsSchema = z.object({
  token: z.string(),
});

const SearchParamsSchema = z.object({
  source: z.string().optional(),
  clientName: z.string().optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { id: userId, workspaceId } = await requireUser(request);

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
    const parsedBase64 = Buffer.from(
      parsedParams.data.token,
      "base64",
    ).toString("utf-8");
    const codeDetails = JSON.parse(parsedBase64);

    await createPersonalAccessTokenFromAuthorizationCode(
      codeDetails.authorizationCode,
      userId,
      workspaceId as string,
      "whatsapp",
    );

    await setPhoneNumber(codeDetails.identifier, userId);

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

  const whatsappNumber = "+12314444889"; // Replace with your actual WhatsApp number
  const whatsappMessage = encodeURIComponent(
    "hey I have connected. What can you do?",
  );

  return (
    <LoginPageLayout>
      <Card className="w-full max-w-[350px] rounded-md bg-transparent p-3">
        <CardHeader className="flex flex-col items-center">
          <CardTitle className="w-full text-center text-xl">
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Fieldset className="w-full">
            <div className="flex flex-col gap-y-2">
              <div className="mb-10 flex justify-center">
                <Logo size={60} />
              </div>

              <div className="flex flex-col items-center space-y-4">
                {result.success ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="text-md text-center">
                      <p>{getInstructionsForSource(result.source)}</p>
                    </div>
                    {result.source === "whatsapp" && (
                      <a
                        href={`https://wa.me/${whatsappNumber}?text=${whatsappMessage}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:outline-none"
                      >
                        Open WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="mb-2">Authentication failed</div>
                    <div className="my-2">{result.error}</div>
                    <p>
                      There was a problem authenticating you, please try logging
                      in again.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Fieldset>
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

function getInstructionsForSource(source: string) {
  if (source) {
    return `Return to your ${prettyClientNames[source] ?? source} to continue.`;
  }

  return `Return to your terminal to continue.`;
}

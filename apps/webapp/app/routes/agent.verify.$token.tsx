import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { setPhoneNumber } from "~/models/user.server";
import { logger } from "~/services/logger.service";
import { createPersonalAccessTokenFromAuthorizationCode } from "~/services/personalAccessToken.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { getUserWorkspaces, getWorkspaceById } from "~/models/workspace.server";
import { saveSession } from "~/services/sessionStorage.server";
import { useFetcher } from "@remix-run/react";
import {
  SuccessView,
  ErrorView,
  AuthorizeView,
} from "~/components/agent-verify";

const ParamsSchema = z.object({
  token: z.string(),
});

const SearchParamsSchema = z.object({
  source: z.string().optional(),
  clientName: z.string().optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const { id: userId } = user;

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

  // Get workspaces for the user
  const workspaces = await getUserWorkspaces(userId);
  const workspaceId = await getWorkspaceId(request, userId, user.workspaceId);
  const currentWorkspace = workspaceId
    ? await getWorkspaceById(workspaceId)
    : workspaces[0] || null;

  const hasMultipleWorkspaces = workspaces.length > 1;

  // If user has only one workspace, auto-authorize
  if (!hasMultipleWorkspaces) {
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
        status: "success" as const,
        source,
        clientName,
      });
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }

      if (error instanceof Error) {
        return typedjson({
          status: "error" as const,
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
  }

  // If user has multiple workspaces, show authorization screen
  return typedjson({
    status: "pending" as const,
    source,
    clientName,
    user,
    workspaces,
    currentWorkspace,
    token: parsedParams.data.token,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const { id: userId } = user;

  const formData = await request.formData();
  const workspaceId = formData.get("workspaceId") as string;
  const token = formData.get("token") as string;
  const source = (formData.get("source") as string) ?? "cli";

  if (!workspaceId || !token) {
    return typedjson({
      status: "error" as const,
      error: "Missing workspaceId or token",
      source,
      clientName: source,
    });
  }

  try {
    const parsedBase64 = Buffer.from(token, "base64").toString("utf-8");
    const codeDetails = JSON.parse(parsedBase64);

    await createPersonalAccessTokenFromAuthorizationCode(
      codeDetails.authorizationCode,
      userId,
      workspaceId,
      "whatsapp",
    );

    await setPhoneNumber(codeDetails.identifier, userId);

    // Update session with new workspaceId
    const headers = await saveSession(request, {
      userId,
      workspaceId,
    });

    return typedjson(
      {
        status: "success" as const,
        source,
        clientName: (formData.get("source") as string | undefined) ?? "unknown",
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Error) {
      return typedjson({
        status: "error" as const,
        error: error.message,
        source,
        clientName: "unknown",
      });
    }

    logger.error(JSON.stringify(error));
    return typedjson({
      status: "error" as const,
      error: "Something went wrong",
      source,
      clientName: "unknown",
    });
  }
};

export default function Page() {
  const result = useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher();

  // Check if fetcher has returned a result
  const fetcherResult = fetcher.data as
    | { status: "success" | "error"; source?: string; error?: string }
    | undefined;

  const showSuccess =
    result.status === "success" || fetcherResult?.status === "success";
  const showError =
    result.status === "error" || fetcherResult?.status === "error";

  const source =
    result.status === "success" || result.status === "error"
      ? result.source
      : (fetcherResult?.source ?? result.source);

  const errorMessage =
    result.status === "error"
      ? result.error
      : fetcherResult?.status === "error"
        ? fetcherResult.error
        : undefined;

  if (showSuccess) {
    return <SuccessView source={source} />;
  }

  if (showError) {
    return <ErrorView error={errorMessage} />;
  }

  if (result.status === "pending") {
    return (
      <AuthorizeView
        user={result.user}
        workspaces={result.workspaces}
        currentWorkspace={result.currentWorkspace}
        clientName={result.source}
        source={result.source}
        token={result.token}
        fetcher={fetcher}
      />
    );
  }

  return null;
}

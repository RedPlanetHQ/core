import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import { requireUser } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { getIntegrationDefinitionWithSlug } from "~/services/integrationDefinition.server";
import { getRedirectURL } from "~/services/oauth/oauth.server";
import { prisma } from "~/db.server";
import { Button } from "~/components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { metadata: true, name: true },
      })
    : null;
  const workspaceMeta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  if (!workspaceMeta.onboardingV2Complete) {
    return redirect("/onboarding");
  }

  // After OAuth callback — gmail is now connected, move to next step
  const gmailAccount = user.workspaceId
    ? await getIntegrationAccountBySlugAndUser(
        "gmail",
        user.id,
        user.workspaceId as string,
      )
    : null;

  if (gmailAccount) {
    return redirect("/onboarding");
  }

  const gmailIntegration = await getIntegrationDefinitionWithSlug("gmail");
  let gmailOAuthUrl = null;
  if (gmailIntegration && user.workspaceId) {
    const redirectBack = `${url.origin}/onboarding/gmail`;
    gmailOAuthUrl = await getRedirectURL(
      {
        integrationDefinitionId: gmailIntegration.id,
        redirectURL: redirectBack,
      },
      user.id,
      user.workspaceId as string,
    );
  }

  return json({
    gmailOAuthUrl,
    defaultName: workspace?.name ?? user.name,
    redirectTo: url.searchParams.get("redirectTo") ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { id: userId } = await requireUser(request);
  const formData = await request.formData();
  const redirectTo = formData.get("redirectTo") as string | null;

  await updateUser({ id: userId, onboardingComplete: true, metadata: {} });
  return redirect(redirectTo || "/home/memory/documents");
}

export default function OnboardingGmail() {
  const { gmailOAuthUrl, defaultName, redirectTo } =
    useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-lg flex-col gap-6 p-6">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">i'm {defaultName}.</h2>
          <div className="text-muted-foreground space-y-2 text-base">
            <p>
              a good butler reads the room. connect gmail and i'll read yours,
              your people, your projects, your priorities.
            </p>
            <p>one minute of context. considerably less fumbling later.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            size="lg"
            variant="ghost"
            onClick={() =>
              fetcher.submit(
                { redirectTo: redirectTo ?? "" },
                { method: "POST" },
              )
            }
            disabled={fetcher.state !== "idle"}
          >
            skip
          </Button>
          {gmailOAuthUrl?.redirectURL && (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                window.location.href = gmailOAuthUrl.redirectURL;
              }}
            >
              Connect Gmail
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

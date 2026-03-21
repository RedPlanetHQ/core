import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { documentsPath } from "~/utils/pathBuilder";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (user.onboardingComplete) {
    return redirect(documentsPath());
  }

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { id: true, metadata: true },
      })
    : null;

  const metadata = (workspace?.metadata ?? {}) as Record<string, unknown>;

  if (!metadata.onboardingV2Complete) {
    return redirect("/onboarding/name");
  }

  const gmailAccount = workspace
    ? await getIntegrationAccountBySlugAndUser("gmail", user.id, workspace.id)
    : null;

  if (!gmailAccount) {
    return redirect("/onboarding/gmail");
  }

  const userMeta = (user.metadata ?? {}) as Record<string, unknown>;
  if (userMeta.onboardingSummary) {
    return redirect("/onboarding/suggestions");
  }

  return redirect("/onboarding/analysis");
}

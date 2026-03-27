import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useFetcher } from "@remix-run/react";
import { z } from "zod";
import { requireUser } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import { getLibrarySkills } from "~/lib/skills-library";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts, getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { makeStructuredModelCall } from "~/lib/model.server";
import { prisma } from "~/db.server";
import { documentsPath } from "~/utils/pathBuilder";
import { OnboardingSuggestions } from "~/components/onboarding/onboarding-suggestions";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (user.onboardingComplete) {
    return redirect(documentsPath());
  }

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { metadata: true },
      })
    : null;
  const workspaceMeta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  if (!workspaceMeta.onboardingV2Complete) {
    return redirect("/onboarding");
  }

  const gmailAccount = user.workspaceId
    ? await getIntegrationAccountBySlugAndUser("gmail", user.id, user.workspaceId as string)
    : null;
  if (!gmailAccount) {
    return redirect("/onboarding");
  }

  const userMeta = (user.metadata ?? {}) as Record<string, unknown>;
  const summary = (userMeta.onboardingSummary as string) || "";

  const [librarySkills, integrationDefs, integrationAccounts] =
    await Promise.all([
      getLibrarySkills(),
      getIntegrationDefinitions(user.workspaceId as string),
      getIntegrationAccounts(user.id, user.workspaceId as string),
    ]);

  const connectedIds = new Set(
    integrationAccounts
      .filter((a) => a.isActive)
      .map((a) => a.integrationDefinitionId),
  );

  if (!summary) {
    return json({ skills: [], integrations: [] as any[] });
  }

  try {
    const { object } = await makeStructuredModelCall(
      z.object({
        skills: z.array(z.string()).describe("slugs of relevant skills, max 4"),
        integrations: z
          .array(z.string())
          .describe("slugs of relevant integrations, max 4"),
      }),
      [{ role: "user", content: `Based on this user profile, pick the most relevant skills and integrations to suggest.

User profile:
${summary}

Available skills:
${JSON.stringify(
  librarySkills.map((s) => ({
    slug: s.slug,
    title: s.title,
    description: s.shortDescription,
  })),
  null,
  2,
)}

Available integrations:
${JSON.stringify(
  integrationDefs.map((i) => ({ slug: i.slug, name: i.name })),
  null,
  2,
)}

Pick up to 4 skills and up to 4 integrations that are clearly relevant for this user. Return only slugs.` }],
      "medium",
      undefined,
      0.3,
    );

    const suggestedIntegrations = integrationDefs.filter((i) =>
      object.integrations.includes(i.slug),
    );

    return json({
      skills: librarySkills.filter((s) => object.skills.includes(s.slug)),
      integrations: suggestedIntegrations.map((i) => ({
        ...i,
        isConnected: connectedIds.has(i.id),
      })),
    });
  } catch {
    return json({ skills: [], integrations: [] });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { id: userId } = await requireUser(request);

  await updateUser({ id: userId, onboardingComplete: true, metadata: {} });

  return redirect("/home/integrations");
}

export default function OnboardingSuggestionsPage() {
  const { skills, integrations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const handleComplete = () => {
    fetcher.submit({}, { method: "POST" });
  };

  return (
    <OnboardingSuggestions
      skills={skills as any}
      integrations={integrations as any}
      onComplete={handleComplete}
      isCompleting={fetcher.state !== "idle"}
    />
  );
}

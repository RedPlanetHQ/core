import { json, type LoaderFunctionArgs } from "@remix-run/node";

import { requireUser, requireWorkpace } from "~/services/session.server";
import { getIntegrationDefinitionWithSlug } from "~/services/integrationDefinition.server";
import { getIntegrationAccounts } from "~/services/integrationAccount.server";

/**
 * Returns a single integration definition by slug, with the user's
 * active accounts for that definition (so the caller can render the
 * connect modal correctly).
 *
 * Lives outside /home so the onboarding chat can hit it before
 * onboardingComplete is true (the /home parent loader redirects
 * pre-onboarding users away). Read-only — no auth-state mutation.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const slug = params.slug;
  if (!slug) {
    return json({ error: "slug is required" }, { status: 400 });
  }

  const integration = await getIntegrationDefinitionWithSlug(slug);
  if (!integration) {
    return json({ error: "integration not found" }, { status: 404 });
  }

  // Optional: surface whether the user already has it connected so the
  // modal can hide redundant Connect buttons.
  const accounts = await getIntegrationAccounts(
    user.id,
    workspace?.id as string,
  );
  const activeAccounts = accounts.filter(
    (a) => a.integrationDefinitionId === integration.id && a.isActive,
  );

  return json({
    integration: {
      id: integration.id,
      slug: integration.slug,
      name: integration.name,
      icon: integration.icon,
      description: integration.description,
      spec: integration.spec,
    },
    activeAccounts,
  });
}

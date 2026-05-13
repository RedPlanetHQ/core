import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useCallback } from "react";
import { useRevalidator } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import {
  getIntegrationAccountBySlugAndUser,
  getIntegrationAccounts,
} from "~/services/integrationAccount.server";
import { getOnboardingConversation } from "~/services/conversation.server";
import { getAvailableModels } from "~/services/llm-provider.server";
import { ConversationView } from "~/components/conversation";

/**
 * Onboarding entry point — the chat page itself.
 *
 * Flow:
 *   1. Gate the user through name → Gmail OAuth (still separate pages).
 *   2. Lazily create (and seed) the user's onboarding Conversation via
 *      getOnboardingConversation.
 *   3. Render the main ConversationView inline. The agent picks up
 *      onboarding mode automatically because
 *      user.onboardingComplete === false, and follows the
 *      <onboarding_mode> prompt block.
 *   4. When the agent calls complete_onboarding, the user row's flag
 *      flips. On the next revalidation (we trigger one whenever a
 *      streamed turn finishes), this loader sees the flag and sends
 *      the user to /home/daily.
 *
 * Until onboardingComplete is true, the user cannot reach /home — they
 * always land back here.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (user.onboardingComplete) {
    return redirect("/home/daily");
  }

  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const workspace = workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: workspaceId },
        select: { id: true, metadata: true },
      })
    : null;

  const metadata = (workspace?.metadata ?? {}) as Record<string, unknown>;
  if (!metadata.onboardingV2Complete) {
    return redirect("/onboarding/name");
  }

  const gmailAccount = await getIntegrationAccountBySlugAndUser(
    "gmail",
    user.id,
    workspaceId,
  );
  if (!gmailAccount) {
    return redirect("/onboarding/gmail");
  }

  const [conversation, integrationAccounts, allModels] = await Promise.all([
    getOnboardingConversation(user.id, workspaceId),
    getIntegrationAccounts(user.id, workspaceId),
    getAvailableModels(),
  ]);

  if (!conversation) {
    // Defensive — getOnboardingConversation always returns a row.
    return redirect("/onboarding/gmail");
  }

  const models = allModels
    .filter(
      (m) => m.capabilities.length === 0 || m.capabilities.includes("chat"),
    )
    .map((m) => ({
      id: `${m.provider.type}/${m.modelId}`,
      modelId: m.modelId,
      label: m.label,
      provider: m.provider.type,
      isDefault: m.isDefault,
    }));

  const integrationAccountMap: Record<string, string> = {};
  const integrationFrontendMap: Record<string, string> = {};
  for (const acc of integrationAccounts) {
    integrationAccountMap[acc.id] = acc.integrationDefinition.slug;
    if (acc.integrationDefinition.frontendUrl) {
      integrationFrontendMap[acc.id] = acc.integrationDefinition.frontendUrl;
    }
  }

  return {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
  };
}

/**
 * Manual skip action — the persistent escape hatch in the onboarding
 * header. Flips user.onboardingComplete = true (preserving the rest of
 * the metadata blob) and drops the user at /home/daily. The agent's
 * complete_onboarding tool does the same thing from the conversation;
 * this is the safety net so a user can always get out of onboarding.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);

  if (!user.onboardingComplete) {
    const existingMetadata =
      (user.metadata as Record<string, unknown> | null) ?? {};
    await prisma.user.update({
      where: { id: user.id },
      data: {
        onboardingComplete: true,
        metadata: existingMetadata,
      },
    });
  }

  return redirect("/home/daily");
}

export default function OnboardingChat() {
  const data = useTypedLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // After every streamed turn, re-run the loader. If the agent has
  // called complete_onboarding, the user.onboardingComplete flag will
  // now be true and the loader will redirect to /home/daily.
  const handleStreamComplete = useCallback(() => {}, [revalidator]);

  if (typeof window === "undefined") return null;

  const {
    conversation,
    integrationAccountMap,
    integrationFrontendMap,
    models,
  } = data;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ConversationView
        key={conversation.id}
        conversationId={conversation.id}
        history={conversation.ConversationHistory}
        integrationAccountMap={integrationAccountMap}
        integrationFrontendMap={integrationFrontendMap}
        conversationStatus={conversation.status}
        models={models}
        autoRegenerate
        hideFirstUserMessage
        onStreamComplete={handleStreamComplete}
      />
    </div>
  );
}

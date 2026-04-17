import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useTypedLoaderData } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ConversationNew } from "~/components/conversation";
import { getAvailableModels } from "~/services/llm-provider.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Only return userId, not the heavy nodeLinks
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const allModels = await getAvailableModels();
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

  const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  const accentColor = (meta.accentColor as string) || "#c87844";
  const url = new URL(request.url);
  const defaultMessage = url.searchParams.get("msg") ?? undefined;
  return { user, models, workspace, accentColor, defaultMessage };
}


export default function Chat() {
  const { user, models, workspace, accentColor, defaultMessage } =
    useTypedLoaderData<typeof loader>();

  if (typeof window === "undefined") return null;

  return (
    <ConversationNew
      user={user}
      models={models}
      name={workspace?.name ?? "core"}
      accentColor={accentColor}
      defaultMessage={defaultMessage}
    />
  );
}

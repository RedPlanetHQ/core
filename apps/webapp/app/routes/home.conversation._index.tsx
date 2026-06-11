import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useTypedLoaderData } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ConversationNew } from "~/components/conversation";
import { getChatComposerModels } from "~/services/llm-provider.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Only return userId, not the heavy nodeLinks
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);
  const models = await getChatComposerModels(workspace?.id);

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

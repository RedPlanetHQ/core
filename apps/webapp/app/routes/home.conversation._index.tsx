import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, requireWorkpace } from "~/services/session.server";
import {
  ensureGeneralistAgent,
  getGeneralistAgent,
} from "~/services/agent.server";

/**
 * Bare `/home/conversation` — redirect to the workspace generalist's
 * conversation. Each agent owns one endless-scroll thread; the URL is
 * always agent-scoped from here on.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const workspace = await requireWorkpace(request);
  if (!workspace) throw redirect("/");

  let generalist = await getGeneralistAgent(workspace.id);
  if (!generalist) {
    generalist = await ensureGeneralistAgent(workspace.id, workspace.name);
  }
  return redirect(`/home/conversation/${generalist.handle}`);
}

export default function ConversationIndex() {
  return null;
}

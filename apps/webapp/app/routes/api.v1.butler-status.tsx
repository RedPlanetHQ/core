import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  getButlerActivity,
  setButlerSnoozeState,
} from "~/services/butler-activity.server";
import { requireUser } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Response("Workspace not found", { status: 404 });
  }

  return json(await getButlerActivity(workspaceId));
}

export async function action({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Response("Workspace not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "resume") {
    await setButlerSnoozeState(workspaceId, { intent: "resume" });
    return json(await getButlerActivity(workspaceId));
  }

  if (intent === "snooze") {
    const duration = formData.get("duration");
    if (
      duration === "30m" ||
      duration === "1h" ||
      duration === "tomorrow" ||
      duration === "indefinite"
    ) {
      await setButlerSnoozeState(workspaceId, { intent: "snooze", duration });
      return json(await getButlerActivity(workspaceId));
    }
  }

  return json({ error: "Invalid request" }, { status: 400 });
}
